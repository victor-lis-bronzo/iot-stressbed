import { BadRequestException, ConflictException } from '@nestjs/common';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { ExperimentsService } from '../experiments/experiments.service';
import { MetricsService } from '../metrics/metrics.service';
import { AttacksService } from './attacks.service';

const mockContainerExec = jest.fn();
const mockGetExec = jest.fn();
const mockDemuxStream = jest.fn(
  (_source: unknown, stdout: PassThrough, _stderr: PassThrough) => {
    // Simula o comportamento real do dockerode: escreve o stdout do processo
    // (o JSON de resultado) no PassThrough que o service acumula.
    if (stdoutToWrite !== null) {
      stdout.write(stdoutToWrite);
    }
  },
);

// Conteúdo que o próximo demuxStream() deve "produzir" como stdout do
// processo — setado por cada teste antes de disparar start().
let stdoutToWrite: string | null = null;

jest.mock('dockerode', () => {
  return jest.fn().mockImplementation(() => ({
    getContainer: jest.fn(() => ({ exec: mockContainerExec })),
    getExec: mockGetExec,
    modem: { demuxStream: mockDemuxStream },
  }));
});

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('AttacksService', () => {
  let experiments: { start: jest.Mock; stop: jest.Mock; findById: jest.Mock };
  let metrics: {
    recordConnectionFloodResult: jest.Mock;
    recordMessageFloodResult: jest.Mock;
    recordMalformedPayloadResult: jest.Mock;
    recordInjectionResult: jest.Mock;
  };
  let service: AttacksService;
  let fakeStream: EventEmitter;

  beforeEach(() => {
    jest.clearAllMocks();
    stdoutToWrite = null;
    fakeStream = new EventEmitter();
    // Curto de propósito: alguns testes deixam um exec "em aberto" (nunca
    // emitem 'end'), o que deixaria um setTimeout REAL de 600000ms pendente
    // e travaria o processo do Jest até ele disparar. Testes que precisam de
    // um timeout maior (ex.: o teste com fake timers) sobrescrevem isso.
    process.env.ATTACKER_EXEC_TIMEOUT_MS = '50';

    mockContainerExec.mockResolvedValue({
      id: 'exec-1',
      start: jest.fn().mockResolvedValue(fakeStream),
    });

    experiments = {
      start: jest.fn().mockResolvedValue({ id: 'run-1', mode: 'plain' }),
      stop: jest.fn().mockResolvedValue({ id: 'run-1', endedAt: new Date() }),
      findById: jest.fn().mockResolvedValue({ id: 'run-1' }),
    };
    metrics = {
      recordConnectionFloodResult: jest.fn().mockResolvedValue(undefined),
      recordMessageFloodResult: jest.fn().mockResolvedValue(undefined),
      recordMalformedPayloadResult: jest.fn().mockResolvedValue(undefined),
      recordInjectionResult: jest.fn().mockResolvedValue(undefined),
    };

    service = new AttacksService(
      experiments as unknown as ExperimentsService,
      metrics as unknown as MetricsService,
    );
  });

  it('starts the run and the container exec for the mapped script', async () => {
    stdoutToWrite = JSON.stringify({ started_at: 'x', finished_at: 'y' });

    await service.start({ track: 'connection-flood', mode: 'plain' });

    expect(experiments.start).toHaveBeenCalledWith({
      mode: 'plain',
      attackType: 'connection-flood',
    });
    expect(mockContainerExec).toHaveBeenCalledWith(
      expect.objectContaining({
        Cmd: ['python', 'python/connection_flood.py', '--target', 'plain'],
      }),
    );
  });

  it('rejects args that override a reserved flag without creating a run', async () => {
    await expect(
      service.start({
        track: 'connection-flood',
        mode: 'plain',
        args: ['--target', 'secure'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(experiments.start).not.toHaveBeenCalled();
    expect(mockContainerExec).not.toHaveBeenCalled();
  });

  it('stops the run when container.exec() fails, instead of leaving it stuck active', async () => {
    mockContainerExec.mockRejectedValueOnce(new Error('attacker container is not running'));

    await expect(
      service.start({ track: 'connection-flood', mode: 'plain' }),
    ).rejects.toThrow('attacker container is not running');

    expect(experiments.stop).toHaveBeenCalledTimes(1);
  });

  it('rejects a second start() while one is already tracked', async () => {
    stdoutToWrite = null; // primeiro exec nunca termina neste teste
    await service.start({ track: 'connection-flood', mode: 'plain' });

    await expect(
      service.start({ track: 'message-flood', mode: 'plain' }),
    ).rejects.toBeInstanceOf(ConflictException);
    // Não deve nem tentar criar uma segunda run.
    expect(experiments.start).toHaveBeenCalledTimes(1);
  });

  it("propagates ExperimentsService.start's ConflictException untouched", async () => {
    experiments.start.mockRejectedValueOnce(
      new ConflictException('a run is already active'),
    );

    await expect(
      service.start({ track: 'connection-flood', mode: 'plain' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(mockContainerExec).not.toHaveBeenCalled();
  });

  it('records the matching Track B result and stops the run on successful completion', async () => {
    const result = { started_at: 'x', finished_at: 'y', accepted: 10 };
    stdoutToWrite = JSON.stringify(result);

    await service.start({ track: 'message-flood', mode: 'secure' });
    // O PassThrough de stdout só entrega o dado bufferizado ao attach do
    // listener 'data' no próximo tick — precisamos de um flush antes de
    // simular o 'end' do exec, senão o buffer ainda está vazio quando o
    // handler de conclusão lê `stdoutBuffer`.
    await flushMicrotasks();
    fakeStream.emit('end');
    await flushMicrotasks();

    expect(metrics.recordMessageFloodResult).toHaveBeenCalledWith(
      'run-1',
      result,
    );
    expect(experiments.stop).toHaveBeenCalledTimes(1);
  });

  it('still stops the run when stdout is not valid JSON (non-fatal)', async () => {
    stdoutToWrite = 'not json at all';

    await service.start({ track: 'malformed-payload', mode: 'plain' });
    fakeStream.emit('end');
    await flushMicrotasks();

    expect(metrics.recordMalformedPayloadResult).not.toHaveBeenCalled();
    expect(experiments.stop).toHaveBeenCalledTimes(1);
  });

  it('delegates to experiments.stop() directly when no attack is tracked', async () => {
    const result = await service.stop();

    expect(experiments.stop).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ id: 'run-1', endedAt: expect.any(Date) });
  });

  it('kills the managed process (SIGTERM) and returns the run when stop() is called mid-execution', async () => {
    jest.useFakeTimers();
    try {
      // Timeout grande de propósito: fake timers não travam o processo real,
      // mas um valor de 50ms (default deste arquivo) dispararia o kill por
      // timeout no meio do advanceTimersByTimeAsync(2000) abaixo, disputando
      // com o kill manual que este teste está validando.
      process.env.ATTACKER_EXEC_TIMEOUT_MS = '600000';
      stdoutToWrite = null; // segue rodando
      mockGetExec.mockReturnValue({
        inspect: jest.fn().mockResolvedValue({ Pid: 4242, Running: false }),
      });
      const killerExec = { start: jest.fn().mockResolvedValue(undefined) };
      mockContainerExec
        .mockResolvedValueOnce({
          id: 'exec-1',
          start: jest.fn().mockResolvedValue(fakeStream),
        })
        .mockResolvedValueOnce(killerExec);

      await service.start({ track: 'connection-flood', mode: 'plain' });

      const stopPromise = service.stop();
      await jest.advanceTimersByTimeAsync(2000);
      await stopPromise;

      expect(killerExec.start).toHaveBeenCalledWith({});
      expect(experiments.findById).toHaveBeenCalledWith('run-1');
    } finally {
      jest.useRealTimers();
    }
  });

  afterAll(() => {
    delete process.env.ATTACKER_EXEC_TIMEOUT_MS;
  });
});
