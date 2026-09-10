import { Repository } from 'typeorm';
import { ExperimentsService } from '../experiments/experiments.service';
import { ExperimentRun } from '../experiments/entities/experiment-run.entity';
import { RunKpi } from './entities/run-kpi.entity';
import { MetricsService } from './metrics.service';
import { FakeTelemetryQuery } from './testing/fake-telemetry-query';

describe('MetricsService', () => {
  let kpis: Partial<Record<keyof Repository<RunKpi>, jest.Mock>>;
  let telemetryQuery: FakeTelemetryQuery;
  let experiments: { findById: jest.Mock };
  let service: MetricsService;

  beforeEach(() => {
    kpis = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((x) => ({ ...x })),
      save: jest.fn((x) => Promise.resolve(x)),
    };
    telemetryQuery = new FakeTelemetryQuery();
    experiments = { findById: jest.fn() };
    service = new MetricsService(
      kpis as unknown as Repository<RunKpi>,
      telemetryQuery,
      experiments as unknown as ExperimentsService,
    );
  });

  describe('recordInjectionResult', () => {
    it('persists connect status and success rate as a percentage', async () => {
      const kpi = await service.recordInjectionResult('run-1', {
        connect_status: 'connected',
        attempted: 20,
        accepted: 18,
        success_rate: 0.9,
      });

      expect(kpi.injectionConnectStatus).toBe('connected');
      expect(kpi.injectionSuccessRatePct).toBe(90);
      expect(kpis.save).toHaveBeenCalledTimes(1);
    });

    it('stores a null success rate when the connection was rejected', async () => {
      const kpi = await service.recordInjectionResult('run-2', {
        connect_status: 'rejected',
        attempted: 0,
        accepted: 0,
        success_rate: null,
      });

      expect(kpi.injectionConnectStatus).toBe('rejected');
      expect(kpi.injectionSuccessRatePct).toBeNull();
    });
  });

  describe('recordPayloadReadability', () => {
    it('persists entropy and classification', async () => {
      const kpi = await service.recordPayloadReadability('run-1', {
        entropyBits: 7.9,
        classification: 'ciphertext',
      });

      expect(kpi.entropyBits).toBe(7.9);
      expect(kpi.payloadReadabilityClassification).toBe('ciphertext');
    });
  });

  describe('recordConnectionFloodResult', () => {
    it('persists the raw jsonb payload and parses started/finished timestamps', async () => {
      const dto = {
        target: 'plain' as const,
        host: 'mosquitto',
        port: 1883,
        connections_attempted: 200,
        connections_established: 150,
        connections_rejected: 50,
        success_rate: 0.75,
        errors: ['conexão não estabelecida: timeout'],
        started_at: '2026-01-01T00:00:00.000Z',
        finished_at: '2026-01-01T00:00:05.000Z',
      };

      const kpi = await service.recordConnectionFloodResult('run-1', dto);

      expect(kpi.trackBAttackType).toBe('connection-flood');
      expect(kpi.trackBResult).toEqual(dto);
      expect(kpi.attackStartedAt).toEqual(new Date('2026-01-01T00:00:00.000Z'));
      expect(kpi.attackFinishedAt).toEqual(new Date('2026-01-01T00:00:05.000Z'));
      expect(kpis.save).toHaveBeenCalledTimes(1);
    });

    it('persists a fully rejected flood (no connections established)', async () => {
      const dto = {
        target: 'secure' as const,
        host: 'mosquitto',
        port: 8883,
        connections_attempted: 10,
        connections_established: 0,
        connections_rejected: 10,
        success_rate: 0,
        errors: ['conexão não estabelecida: handshake abortado (sem CONNACK)'],
        started_at: '2026-01-01T00:00:00.000Z',
        finished_at: '2026-01-01T00:00:01.000Z',
      };

      const kpi = await service.recordConnectionFloodResult('run-2', dto);

      expect(kpi.trackBAttackType).toBe('connection-flood');
      expect(kpi.trackBResult).toEqual(dto);
    });
  });

  describe('recordMessageFloodResult', () => {
    it('persists the raw jsonb payload and parses started/finished timestamps', async () => {
      const dto = {
        target: 'plain' as const,
        topic: 'sensors/sensor-1/telemetry',
        host: 'mosquitto',
        port: 1883,
        connect_status: 'connected' as const,
        connect_error: null,
        attempted: 500,
        accepted: 480,
        success_rate: 0.96,
        elapsed_seconds: 10.2,
        achieved_rate: 49.0,
        started_at: '2026-01-01T00:00:00.000Z',
        finished_at: '2026-01-01T00:00:10.200Z',
      };

      const kpi = await service.recordMessageFloodResult('run-1', dto);

      expect(kpi.trackBAttackType).toBe('message-flood');
      expect(kpi.trackBResult).toEqual(dto);
      expect(kpi.attackStartedAt).toEqual(new Date('2026-01-01T00:00:00.000Z'));
      expect(kpi.attackFinishedAt).toEqual(new Date('2026-01-01T00:00:10.200Z'));
      expect(kpis.save).toHaveBeenCalledTimes(1);
    });

    it('persists a rejected connection with zeroed/null counters', async () => {
      const dto = {
        target: 'secure' as const,
        topic: 'sensors/sensor-1/telemetry',
        host: 'mosquitto',
        port: 8883,
        connect_status: 'rejected' as const,
        connect_error: 'conexão não estabelecida: handshake abortado (sem CONNACK)',
        attempted: 0,
        accepted: 0,
        success_rate: null,
        elapsed_seconds: 0,
        achieved_rate: 0,
        started_at: '2026-01-01T00:00:00.000Z',
        finished_at: '2026-01-01T00:00:00.500Z',
      };

      const kpi = await service.recordMessageFloodResult('run-2', dto);

      expect(kpi.trackBAttackType).toBe('message-flood');
      expect((kpi.trackBResult as typeof dto).connect_status).toBe('rejected');
      expect((kpi.trackBResult as typeof dto).success_rate).toBeNull();
    });
  });

  describe('recordMalformedPayloadResult', () => {
    it('persists the raw jsonb payload and parses started/finished timestamps', async () => {
      const dto = {
        target: 'plain' as const,
        topic: 'sensors/sensor-1/telemetry',
        host: 'mosquitto',
        port: 1883,
        mode: 'giant' as const,
        connect_status: 'connected' as const,
        connect_error: null,
        attempted: 3,
        publish_accepted: 3,
        disconnected_after_publish: true,
        broker_response_summary: 'broker desconectou apos publish',
        started_at: '2026-01-01T00:00:00.000Z',
        finished_at: '2026-01-01T00:00:02.000Z',
      };

      const kpi = await service.recordMalformedPayloadResult('run-1', dto);

      expect(kpi.trackBAttackType).toBe('malformed-payload');
      expect(kpi.trackBResult).toEqual(dto);
      expect(kpi.attackStartedAt).toEqual(new Date('2026-01-01T00:00:00.000Z'));
      expect(kpi.attackFinishedAt).toEqual(new Date('2026-01-01T00:00:02.000Z'));
      expect(kpis.save).toHaveBeenCalledTimes(1);
    });

    it('persists a rejected connection with zeroed counters', async () => {
      const dto = {
        target: 'secure' as const,
        topic: 'sensors/sensor-1/telemetry',
        host: 'mosquitto',
        port: 8883,
        mode: 'invalid-json' as const,
        connect_status: 'rejected' as const,
        connect_error: 'conexão não estabelecida: handshake abortado (sem CONNACK)',
        attempted: 0,
        publish_accepted: 0,
        disconnected_after_publish: false,
        broker_response_summary: 'erro no cliente ao publicar',
        started_at: '2026-01-01T00:00:00.000Z',
        finished_at: '2026-01-01T00:00:00.300Z',
      };

      const kpi = await service.recordMalformedPayloadResult('run-2', dto);

      expect(kpi.trackBAttackType).toBe('malformed-payload');
      expect((kpi.trackBResult as typeof dto).connect_status).toBe('rejected');
      expect((kpi.trackBResult as typeof dto).disconnected_after_publish).toBe(
        false,
      );
    });
  });

  describe('handleRunStopped', () => {
    const baseRun = {
      id: 'run-1',
      mode: 'plain' as const,
      startedAt: new Date('2026-01-01T00:00:00.000Z'),
      params: null as Record<string, unknown> | null,
    };

    it('calculates coverage when expectedMessageCount is set in run params', async () => {
      experiments.findById.mockResolvedValue({
        ...baseRun,
        params: { expectedMessageCount: 100 },
      });
      telemetryQuery.seed('run-1', 'plain', {
        count: 99,
        firstTimestamp: new Date('2026-01-01T00:00:01.000Z'),
      });

      await service.handleRunStopped('run-1');

      expect(kpis.save).toHaveBeenCalledTimes(1);
      const saved = kpis.save!.mock.calls[0][0] as RunKpi;
      expect(saved.interceptionCoveragePct).toBe(99);
      expect(saved.timeToFirstCaptureMs).toBe(1000);
    });

    it('leaves coverage null when expectedMessageCount is not provided', async () => {
      experiments.findById.mockResolvedValue({ ...baseRun, params: null });
      telemetryQuery.seed('run-1', 'plain', {
        count: 42,
        firstTimestamp: null,
      });

      await service.handleRunStopped('run-1');

      const saved = kpis.save!.mock.calls[0][0] as RunKpi;
      expect(saved.interceptionCoveragePct).toBeNull();
      expect(saved.timeToFirstCaptureMs).toBeNull();
    });

    it('does nothing (and does not throw) for an unknown run id', async () => {
      experiments.findById.mockResolvedValue(null);

      await expect(service.handleRunStopped('missing')).resolves.toBeUndefined();
      expect(kpis.save).not.toHaveBeenCalled();
    });
  });

  describe('getForRun / listAll', () => {
    it('delegates to the repository', async () => {
      kpis.findOne!.mockResolvedValue({ runId: 'run-1' });
      await expect(service.getForRun('run-1')).resolves.toEqual({
        runId: 'run-1',
      });

      kpis.find = jest.fn().mockResolvedValue([{ runId: 'run-1' }]);
      await expect(service.listAll()).resolves.toEqual([{ runId: 'run-1' }]);
    });
  });
});
