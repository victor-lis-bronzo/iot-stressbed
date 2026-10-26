import { Inject, Injectable, Logger } from '@nestjs/common';
import { ExperimentRun } from '../experiments/entities/experiment-run.entity';
import { ExperimentsService } from '../experiments/experiments.service';
import { ConnectionFloodResultDto } from '../metrics/dto/connection-flood-result.dto';
import { InjectionResultDto } from '../metrics/dto/injection-result.dto';
import { MalformedPayloadResultDto } from '../metrics/dto/malformed-payload-result.dto';
import { MessageFloodResultDto } from '../metrics/dto/message-flood-result.dto';
import { MetricsService } from '../metrics/metrics.service';
import { ATTACK_RUNNER } from './attacks.tokens';
import { LaunchRunDto } from './dto/launch-run.dto';
import { paramsToArgs } from './params-to-args';
import {
  AttackResponse,
  AttackRunnerPort,
  AttackType,
} from './ports/attack-runner.port';

/**
 * Orquestra uma run disparada pelo dashboard (ADR-0012): start -> ataque no
 * attacker -> registro do KPI -> stop. É a mesma sequência que o antigo
 * run-experiment.sh fazia por fora, agora num único caminho no api.
 *
 * Vive fora do ExperimentsModule porque MetricsModule já importa
 * ExperimentsModule: pôr isto lá criaria uma dependência circular.
 */
@Injectable()
export class AttackOrchestratorService {
  private readonly logger = new Logger(AttackOrchestratorService.name);
  private readonly inflight = new Set<Promise<void>>();

  constructor(
    private readonly experiments: ExperimentsService,
    private readonly metrics: MetricsService,
    @Inject(ATTACK_RUNNER) private readonly runner: AttackRunnerPort,
  ) {}

  /**
   * Cria a run (409 se já há uma ativa, ADR-0006) e devolve na hora; o ataque
   * roda em background. Os params são convertidos ANTES do start para que um
   * pedido inválido (400) não deixe uma run criada para trás.
   */
  async launch(dto: LaunchRunDto): Promise<ExperimentRun> {
    const args = paramsToArgs(dto.params);
    const run = await this.experiments.start({
      mode: dto.mode,
      attackType: dto.attackType,
      params: dto.params,
      notes: dto.notes,
    });
    const work = this.execute(run, dto, args);
    this.inflight.add(work);
    void work.finally(() => this.inflight.delete(work));
    return run;
  }

  /** Espera os ataques em background terminarem (testes e desligamento limpo). */
  async whenIdle(): Promise<void> {
    await Promise.allSettled([...this.inflight]);
  }

  private async execute(
    run: ExperimentRun,
    dto: LaunchRunDto,
    args: string[],
  ): Promise<void> {
    try {
      const response = await this.runner.run({
        attackType: dto.attackType,
        mode: dto.mode,
        args,
      });
      this.logger.log(
        `run ${run.id}: ${dto.attackType}/${dto.mode} terminou (exit ${response.exitCode})`,
      );
      await this.recordResult(run.id, dto.attackType, response);
    } catch (err) {
      this.logger.error(
        `run ${run.id}: falha ao executar ${dto.attackType}/${dto.mode}`,
        err as Error,
      );
    } finally {
      // Sempre encerra, como o `trap EXIT` do script: uma run presa como ativa
      // bloquearia todas as próximas (ADR-0006).
      try {
        await this.experiments.stop();
      } catch (err) {
        this.logger.error(`run ${run.id}: falha ao encerrar a run`, err as Error);
      }
    }
  }

  private async recordResult(
    runId: string,
    attackType: AttackType,
    response: AttackResponse,
  ): Promise<void> {
    if (!response.result) {
      this.logger.warn(
        `run ${runId}: o ataque não devolveu JSON de resultado; KPI não registrado`,
      );
      return;
    }
    const result = response.result;
    switch (attackType) {
      case 'injection':
        await this.metrics.recordInjectionResult(
          runId,
          result as unknown as InjectionResultDto,
        );
        break;
      case 'connection-flood':
        await this.metrics.recordConnectionFloodResult(
          runId,
          result as unknown as ConnectionFloodResultDto,
        );
        break;
      case 'message-flood':
        await this.metrics.recordMessageFloodResult(
          runId,
          result as unknown as MessageFloodResultDto,
        );
        break;
      case 'malformed-payload':
        await this.metrics.recordMalformedPayloadResult(
          runId,
          result as unknown as MalformedPayloadResultDto,
        );
        break;
    }
  }
}
