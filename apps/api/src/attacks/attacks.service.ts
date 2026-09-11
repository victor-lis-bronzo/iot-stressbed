import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import Docker from 'dockerode';
import { PassThrough } from 'stream';
import { ExperimentRun } from '../experiments/entities/experiment-run.entity';
import { ExperimentsService } from '../experiments/experiments.service';
import { MetricsService } from '../metrics/metrics.service';
import { AttackTrack, StartAttackDto } from './dto/start-attack.dto';

const ATTACKER_CONTAINER = 'attacker';

const ATTACK_SCRIPTS: Record<AttackTrack, string> = {
  injection: 'python/injector.py',
  'connection-flood': 'python/connection_flood.py',
  'message-flood': 'python/message_flood.py',
  'malformed-payload': 'python/malformed_payload.py',
};

// Intervalo entre o SIGTERM e a checagem que decide se escala para SIGKILL —
// nomeado em vez de inline para não virar um "número mágico" na chamada de
// stop().
const KILL_GRACE_PERIOD_MS = 2000;

// `--target` é sempre fixado pelo servidor a partir de `dto.mode` (a coluna
// `ExperimentRun.mode` tem que refletir o broker realmente atacado); `--host`/
// `--port` permitiriam apontar o script para fora do broker resolvido pelo
// nome do serviço na rede da stack. Qualquer flag em `dto.args` que colida com
// essas é rejeitada em vez de silenciosamente "vencer" no argparse do script.
const RESERVED_FLAGS = ['--target', '--host', '--port'];

interface ManagedExecution {
  execId: string;
  runId: string;
  track: AttackTrack;
  timeout: NodeJS.Timeout;
}

@Injectable()
export class AttacksService {
  private readonly logger = new Logger(AttacksService.name);
  private readonly docker = new Docker();
  private current: ManagedExecution | null = null;

  constructor(
    private readonly experiments: ExperimentsService,
    private readonly metrics: MetricsService,
  ) {}

  async start(dto: StartAttackDto): Promise<ExperimentRun> {
    if (this.current) {
      throw new ConflictException(
        'An attack is already running; stop it before starting another',
      );
    }

    const collidingFlag = (dto.args ?? []).find((arg) =>
      RESERVED_FLAGS.includes(arg),
    );
    if (collidingFlag) {
      throw new BadRequestException(
        `args must not override ${collidingFlag} — it is set by the server from mode/track`,
      );
    }

    // Propaga o ConflictException do singleton (ADR-0006) sem reinterpretar —
    // cobre também uma run iniciada via CLI (run-experiment.sh).
    const run = await this.experiments.start({
      mode: dto.mode,
      attackType: dto.track,
    });

    try {
      const scriptPath = ATTACK_SCRIPTS[dto.track];
      const container = this.docker.getContainer(ATTACKER_CONTAINER);
      const exec = await container.exec({
        Cmd: ['python', scriptPath, '--target', dto.mode, ...(dto.args ?? [])],
        AttachStdout: true,
        AttachStderr: true,
      });

      const stream = await exec.start({ hijack: true, stdin: false });

      const stdout = new PassThrough();
      const stderr = new PassThrough();
      // Sem Tty, o Docker multiplexa stdout/stderr no mesmo stream com um
      // cabeçalho de 8 bytes por frame — demuxStream desfaz isso. Com
      // Tty: true o parsing do JSON de stdout quebraria (frames sem
      // cabeçalho, stdout/stderr misturados).
      this.docker.modem.demuxStream(stream, stdout, stderr);

      let stdoutBuffer = '';
      stdout.on('data', (chunk: Buffer) => {
        stdoutBuffer += chunk.toString('utf8');
      });
      stderr.on('data', (chunk: Buffer) => {
        this.logger.debug(`[${dto.track}] ${chunk.toString('utf8').trimEnd()}`);
      });

      const timeoutMs = Number(process.env.ATTACKER_EXEC_TIMEOUT_MS ?? 600_000);
      const timeout = setTimeout(() => {
        this.logger.warn(
          `attack ${dto.track} (run ${run.id}) exceeded ${timeoutMs}ms; killing`,
        );
        void this.killManagedProcess();
      }, timeoutMs);

      this.current = { execId: exec.id, runId: run.id, track: dto.track, timeout };

      stream.on('end', () => {
        void this.handleExecFinished(run.id, dto.track, stdoutBuffer);
      });

      return run;
    } catch (err) {
      // A run já foi criada (singleton ADR-0006) — se o Docker falhar antes
      // de termos um processo gerenciado (container `attacker` fora do ar,
      // socket sem permissão, etc.), a run não pode ficar presa como ativa
      // bloqueando todo disparo futuro.
      this.logger.error(
        `failed to start attack ${dto.track} for run ${run.id}`,
        err as Error,
      );
      await this.experiments.stop();
      throw err;
    }
  }

  async stop(): Promise<ExperimentRun | null> {
    if (this.current) {
      const runId = this.current.runId;
      // O kill dispara o fim do exec original, cujo handler `end` (registrado
      // em start()) já faz o registro de métricas + experiments.stop() +
      // limpeza — não duplicamos essa lógica aqui.
      await this.killManagedProcess();
      return this.experiments.findById(runId);
    }
    // Sem processo gerenciado (ex.: run iniciada via CLI) — mesmo caminho que
    // /experiments/runs/stop já usava antes desta feature existir.
    return this.experiments.stop();
  }

  private async handleExecFinished(
    runId: string,
    track: AttackTrack,
    stdoutBuffer: string,
  ): Promise<void> {
    if (this.current) {
      clearTimeout(this.current.timeout);
    }
    this.current = null;

    try {
      const result = JSON.parse(stdoutBuffer) as Record<string, unknown>;
      await this.recordResult(runId, track, result);
    } catch (err) {
      this.logger.error(
        `failed to parse/record result for run ${runId} (${track}): ${stdoutBuffer}`,
        err as Error,
      );
    }

    // Sempre encerra a run, mesmo se o parsing/registro de KPI falhou —
    // mesmo espírito do `trap stop_run EXIT` em scripts/run-experiment.sh.
    try {
      await this.experiments.stop();
    } catch (err) {
      this.logger.error(`failed to stop run ${runId}`, err as Error);
    }
  }

  private recordResult(
    runId: string,
    track: AttackTrack,
    result: Record<string, unknown>,
  ): Promise<unknown> {
    switch (track) {
      case 'injection':
        return this.metrics.recordInjectionResult(runId, result as never);
      case 'connection-flood':
        return this.metrics.recordConnectionFloodResult(runId, result as never);
      case 'message-flood':
        return this.metrics.recordMessageFloodResult(runId, result as never);
      case 'malformed-payload':
        return this.metrics.recordMalformedPayloadResult(runId, result as never);
    }
  }

  private async killManagedProcess(): Promise<void> {
    if (!this.current) {
      return;
    }
    // Capturado antes do delay: `this.current` pode virar null enquanto
    // esperamos (o handler `end` do exec original roda concorrentemente se o
    // processo sair sozinho durante a janela de graça).
    const execId = this.current.execId;
    await this.signalExec(execId, 'SIGTERM');
    await this.delay(KILL_GRACE_PERIOD_MS);
    if (await this.isExecRunning(execId)) {
      await this.signalExec(execId, 'SIGKILL');
    }
  }

  private async isExecRunning(execId: string | undefined): Promise<boolean> {
    if (!execId) {
      return false;
    }
    const info = await this.docker.getExec(execId).inspect();
    return Boolean(info.Running);
  }

  // Não existe "kill de exec" na Docker Engine API — o processo é sinalizado
  // rodando um segundo exec de vida curta no MESMO container (mesmo
  // namespace de PID), usando o próprio Python para não depender de um
  // binário `kill` que a imagem python:3.12-slim pode não ter instalado.
  private async signalExec(
    execId: string,
    signal: 'SIGTERM' | 'SIGKILL',
  ): Promise<void> {
    const info = await this.docker.getExec(execId).inspect();
    const pid = info.Pid;
    if (!pid) {
      return;
    }
    const killer = await this.docker.getContainer(ATTACKER_CONTAINER).exec({
      Cmd: [
        'python',
        '-c',
        `import os, signal; os.kill(${pid}, signal.${signal})`,
      ],
    });
    await killer.start({});
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
