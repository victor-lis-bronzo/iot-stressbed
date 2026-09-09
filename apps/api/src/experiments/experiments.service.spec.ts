import { ConflictException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { ExperimentsService } from './experiments.service';
import { ExperimentRun } from './entities/experiment-run.entity';
import { RUN_STOPPED } from './experiments.tokens';

describe('ExperimentsService (singleton run)', () => {
  let runs: Partial<Record<keyof Repository<ExperimentRun>, jest.Mock>>;
  let events: EventEmitter2;
  let service: ExperimentsService;

  beforeEach(() => {
    runs = {
      findOne: jest.fn(),
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve({ id: 'run-new', ...x })),
    };
    events = new EventEmitter2();
    service = new ExperimentsService(
      runs as unknown as Repository<ExperimentRun>,
      events,
    );
  });

  it('starts a run when none is active', async () => {
    runs.findOne!.mockResolvedValue(null);
    const run = await service.start({ mode: 'plain', attackType: 'baseline' });
    expect(run.id).toBe('run-new');
    expect(runs.save).toHaveBeenCalledTimes(1);
  });

  it('rejects starting a second run while one is active', async () => {
    runs.findOne!.mockResolvedValue({ id: 'run-active', endedAt: null });
    await expect(
      service.start({ mode: 'secure', attackType: 'baseline' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(runs.save).not.toHaveBeenCalled();
  });

  it('resolves injected source from an active injection run', async () => {
    runs.findOne!.mockResolvedValue({ id: 'run-active', attackType: 'injection' });
    await expect(service.resolveCaptureContext()).resolves.toEqual({
      runId: 'run-active',
      source: 'injected',
    });
  });

  it('resolves a null run and legit source when nothing is active', async () => {
    runs.findOne!.mockResolvedValue(null);
    await expect(service.resolveCaptureContext()).resolves.toEqual({
      runId: null,
      source: 'legit',
    });
  });

  it('emits RUN_STOPPED with the stopped run id when stopping an active run', async () => {
    runs.findOne!.mockResolvedValue({ id: 'run-active', endedAt: null });
    const listener = jest.fn();
    events.on(RUN_STOPPED, listener);

    await service.stop();

    expect(listener).toHaveBeenCalledWith('run-active');
  });

  it('does not emit RUN_STOPPED when there is no active run to stop', async () => {
    runs.findOne!.mockResolvedValue(null);
    const listener = jest.fn();
    events.on(RUN_STOPPED, listener);

    await service.stop();

    expect(listener).not.toHaveBeenCalled();
  });
});
