import { BadRequestException, ConflictException } from '@nestjs/common';
import { ExperimentRun } from '../experiments/entities/experiment-run.entity';
import { ExperimentsService } from '../experiments/experiments.service';
import { MetricsService } from '../metrics/metrics.service';
import { AttackOrchestratorService } from './attack-orchestrator.service';
import { LaunchRunDto } from './dto/launch-run.dto';
import {
  AttackResponse,
  AttackRunnerPort,
} from './ports/attack-runner.port';

describe('AttackOrchestratorService', () => {
  const run = { id: 'run-1' } as ExperimentRun;
  let experiments: { start: jest.Mock; stop: jest.Mock };
  let metrics: Record<string, jest.Mock>;
  let runner: { run: jest.Mock };
  let service: AttackOrchestratorService;

  const ok = (result: Record<string, unknown> | null): AttackResponse => ({
    result,
    exitCode: 0,
    stderr: '',
  });

  beforeEach(() => {
    experiments = {
      start: jest.fn().mockResolvedValue(run),
      stop: jest.fn().mockResolvedValue(run),
    };
    metrics = {
      recordInjectionResult: jest.fn(),
      recordConnectionFloodResult: jest.fn(),
      recordMessageFloodResult: jest.fn(),
      recordMalformedPayloadResult: jest.fn(),
    };
    runner = { run: jest.fn().mockResolvedValue(ok({ attempted: 1 })) };
    service = new AttackOrchestratorService(
      experiments as unknown as ExperimentsService,
      metrics as unknown as MetricsService,
      runner as AttackRunnerPort,
    );
    jest.spyOn(service['logger'], 'error').mockImplementation();
    jest.spyOn(service['logger'], 'warn').mockImplementation();
    jest.spyOn(service['logger'], 'log').mockImplementation();
  });

  it('starts the run with mode/attackType/params, runs the attack with the args, records the KPI and stops', async () => {
    const dto: LaunchRunDto = {
      mode: 'plain',
      attackType: 'connection-flood',
      params: { connections: 200 },
    };

    const returned = await service.launch(dto);
    await service.whenIdle();

    expect(returned).toBe(run);
    expect(experiments.start).toHaveBeenCalledWith({
      mode: 'plain',
      attackType: 'connection-flood',
      params: { connections: 200 },
      notes: undefined,
    });
    expect(runner.run).toHaveBeenCalledWith({
      attackType: 'connection-flood',
      mode: 'plain',
      args: ['--connections', '200'],
    });
    expect(metrics.recordConnectionFloodResult).toHaveBeenCalledWith('run-1', {
      attempted: 1,
    });
    expect(experiments.stop).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['injection', 'recordInjectionResult'],
    ['connection-flood', 'recordConnectionFloodResult'],
    ['message-flood', 'recordMessageFloodResult'],
    ['malformed-payload', 'recordMalformedPayloadResult'],
  ] as const)('%s records its KPI with %s and no other', async (attackType, method) => {
    await service.launch({ mode: 'secure', attackType });
    await service.whenIdle();

    expect(metrics[method]).toHaveBeenCalledWith('run-1', { attempted: 1 });
    for (const other of Object.keys(metrics).filter((m) => m !== method)) {
      expect(metrics[other]).not.toHaveBeenCalled();
    }
  });

  it('returns before the attack finishes and only stops the run afterwards', async () => {
    let finish!: (r: AttackResponse) => void;
    runner.run.mockReturnValue(new Promise((res) => (finish = res)));

    await service.launch({ mode: 'plain', attackType: 'message-flood' });
    expect(experiments.stop).not.toHaveBeenCalled();

    finish(ok({ attempted: 9 }));
    await service.whenIdle();
    expect(experiments.stop).toHaveBeenCalledTimes(1);
    expect(metrics.recordMessageFloodResult).toHaveBeenCalled();
  });

  it('rejects with 409 when a run is already active, without running anything', async () => {
    experiments.start.mockRejectedValue(new ConflictException('active'));

    await expect(
      service.launch({ mode: 'plain', attackType: 'connection-flood' }),
    ).rejects.toThrow(ConflictException);
    await service.whenIdle();

    expect(runner.run).not.toHaveBeenCalled();
    expect(experiments.stop).not.toHaveBeenCalled();
  });

  it('rejects invalid params with 400 BEFORE creating a run', async () => {
    await expect(
      service.launch({
        mode: 'plain',
        attackType: 'connection-flood',
        params: { '--host': 'x' },
      }),
    ).rejects.toThrow(BadRequestException);

    expect(experiments.start).not.toHaveBeenCalled();
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('still stops the run when the runner fails, and records no KPI', async () => {
    runner.run.mockRejectedValue(new Error('attacker runner: HTTP 502'));

    await service.launch({ mode: 'plain', attackType: 'injection' });
    await service.whenIdle();

    expect(experiments.stop).toHaveBeenCalledTimes(1);
    expect(metrics.recordInjectionResult).not.toHaveBeenCalled();
  });

  it('records nothing but still stops when the attack returned no JSON', async () => {
    runner.run.mockResolvedValue(ok(null));

    await service.launch({ mode: 'plain', attackType: 'injection' });
    await service.whenIdle();

    expect(metrics.recordInjectionResult).not.toHaveBeenCalled();
    expect(experiments.stop).toHaveBeenCalledTimes(1);
  });

  it('still stops the run when recording the KPI throws', async () => {
    metrics.recordConnectionFloodResult.mockRejectedValue(new Error('db'));

    await service.launch({ mode: 'plain', attackType: 'connection-flood' });
    await service.whenIdle();

    expect(experiments.stop).toHaveBeenCalledTimes(1);
  });

  it('does not leak an unhandled rejection when stop itself fails', async () => {
    experiments.stop.mockRejectedValue(new Error('db down'));

    await service.launch({ mode: 'plain', attackType: 'injection' });
    await expect(service.whenIdle()).resolves.toBeUndefined();
  });
});
