import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { ExperimentsService } from '../experiments/experiments.service';
import { RUN_STOPPED } from '../experiments/experiments.tokens';
import { InjectionResultDto } from './dto/injection-result.dto';
import { PayloadReadabilityDto } from './dto/payload-readability.dto';
import { RunKpi } from './entities/run-kpi.entity';
import { TELEMETRY_QUERY } from './metrics.tokens';
import { TelemetryQueryPort } from './ports/telemetry-query.port';

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  constructor(
    @InjectRepository(RunKpi)
    private readonly kpis: Repository<RunKpi>,
    @Inject(TELEMETRY_QUERY)
    private readonly telemetryQuery: TelemetryQueryPort,
    private readonly experiments: ExperimentsService,
  ) {}

  private async findOrCreate(runId: string): Promise<RunKpi> {
    const existing = await this.kpis.findOne({ where: { runId } });
    return existing ?? this.kpis.create({ runId });
  }

  async recordInjectionResult(
    runId: string,
    dto: InjectionResultDto,
  ): Promise<RunKpi> {
    const kpi = await this.findOrCreate(runId);
    kpi.injectionConnectStatus = dto.connect_status;
    kpi.injectionSuccessRatePct =
      dto.success_rate !== undefined && dto.success_rate !== null
        ? dto.success_rate * 100
        : null;
    kpi.calculatedAt = new Date();
    return this.kpis.save(kpi);
  }

  async recordPayloadReadability(
    runId: string,
    dto: PayloadReadabilityDto,
  ): Promise<RunKpi> {
    const kpi = await this.findOrCreate(runId);
    kpi.entropyBits = dto.entropyBits;
    kpi.payloadReadabilityClassification = dto.classification;
    kpi.calculatedAt = new Date();
    return this.kpis.save(kpi);
  }

  /**
   * Cálculo automático dos KPIs derivados de InfluxDB (cobertura e tempo até
   * primeira captura) ao encerrar uma run — decisão do usuário de acoplar via
   * evento em vez de exigir chamada manual do operador.
   */
  @OnEvent(RUN_STOPPED)
  async handleRunStopped(runId: string): Promise<void> {
    try {
      const run = await this.experiments.findById(runId);
      if (!run) {
        this.logger.warn(`RUN_STOPPED for unknown run ${runId}; skipping KPI calc`);
        return;
      }

      const kpi = await this.findOrCreate(runId);
      const expectedMessageCount = this.readExpectedMessageCount(run.params);

      kpi.interceptionCoveragePct =
        expectedMessageCount !== null
          ? ((await this.telemetryQuery.countCapturedPoints(runId, run.mode)) /
              expectedMessageCount) *
            100
          : null;

      const firstCapture = await this.telemetryQuery.firstPointTimestamp(
        runId,
        run.mode,
      );
      kpi.timeToFirstCaptureMs = firstCapture
        ? firstCapture.getTime() - run.startedAt.getTime()
        : null;

      kpi.calculatedAt = new Date();
      await this.kpis.save(kpi);
    } catch (err) {
      this.logger.error(
        `failed to calculate KPIs for run ${runId}`,
        err as Error,
      );
    }
  }

  private readExpectedMessageCount(
    params: Record<string, unknown> | null,
  ): number | null {
    const value = params?.expectedMessageCount;
    return typeof value === 'number' && Number.isFinite(value) && value > 0
      ? value
      : null;
  }

  getForRun(runId: string): Promise<RunKpi | null> {
    return this.kpis.findOne({ where: { runId } });
  }

  listAll(): Promise<RunKpi[]> {
    return this.kpis.find({ order: { calculatedAt: 'DESC' } });
  }
}
