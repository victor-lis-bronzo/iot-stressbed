import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ExperimentsService } from '../experiments/experiments.service';
import { CaptureService } from './capture.service';
import { TELEMETRY_CAPTURED } from './capture.tokens';
import { TelemetryPoint } from './ports/telemetry';
import { FakeMqttSubscriber } from './testing/fake-mqtt-subscriber';
import { FakeTelemetrySink } from './testing/fake-telemetry-sink';

function configFor(overrides: Record<string, string> = {}): ConfigService {
  const values: Record<string, string> = {
    CAPTURE_BROKER: 'plain',
    CAPTURE_TOPIC: '#',
    CAPTURE_ENABLED: 'true',
    ...overrides,
  };
  return {
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
  } as unknown as ConfigService;
}

describe('CaptureService', () => {
  let subscriber: FakeMqttSubscriber;
  let sink: FakeTelemetrySink;
  let events: EventEmitter2;
  let experiments: { resolveCaptureContext: jest.Mock };
  let service: CaptureService;

  beforeEach(async () => {
    subscriber = new FakeMqttSubscriber();
    sink = new FakeTelemetrySink();
    events = new EventEmitter2();
    experiments = {
      resolveCaptureContext: jest
        .fn()
        .mockResolvedValue({ runId: 'run-1', source: 'legit' }),
    };
    service = new CaptureService(
      subscriber,
      sink,
      experiments as unknown as ExperimentsService,
      events,
      configFor(),
    );
    await service.onModuleInit();
  });

  it('subscribes to # on init', () => {
    expect(subscriber.connected).toBe(true);
  });

  it('normalizes and persists exactly the messages published, tagged correctly', async () => {
    await subscriber.publish({
      topic: 'sensors/esp32-01/telemetry',
      payload: JSON.stringify({ temperature: 24.5, humidity: 60.2 }),
    });
    await subscriber.publish({
      topic: 'sensors/esp32-02/telemetry',
      payload: JSON.stringify({ temperature: 19.1, humidity: 71 }),
    });

    expect(sink.points).toHaveLength(2);
    const [first] = sink.points;
    expect(first).toMatchObject<Partial<TelemetryPoint>>({
      sensorId: 'esp32-01',
      temperature: 24.5,
      humidity: 60.2,
      broker: 'plain',
      runId: 'run-1',
      source: 'legit',
    });
    expect(sink.points[1].sensorId).toBe('esp32-02');
  });

  it('emits one realtime event per captured message', async () => {
    const received: TelemetryPoint[] = [];
    events.on(TELEMETRY_CAPTURED, (p: TelemetryPoint) => received.push(p));

    await subscriber.publish({
      topic: 'sensors/esp32-01/telemetry',
      payload: JSON.stringify({ temperature: 20, humidity: 50 }),
    });
    await subscriber.publish({
      topic: 'sensors/esp32-01/telemetry',
      payload: JSON.stringify({ temperature: 21, humidity: 51 }),
    });

    expect(received).toHaveLength(2);
    expect(received).toEqual(sink.points);
  });

  it('records a malformed payload as raw with null readings', async () => {
    await subscriber.publish({
      topic: 'sensors/esp32-01/telemetry',
      payload: 'not-json-garbage',
    });

    expect(sink.points).toHaveLength(1);
    expect(sink.points[0]).toMatchObject({
      temperature: null,
      humidity: null,
      raw: 'not-json-garbage',
    });
  });

  it('tags source=injected from the active run context', async () => {
    experiments.resolveCaptureContext.mockResolvedValue({
      runId: 'run-A',
      source: 'injected',
    });
    await subscriber.publish({
      topic: 'sensors/esp32-01/telemetry',
      payload: JSON.stringify({ temperature: 99, humidity: 1 }),
    });
    expect(sink.points[0].source).toBe('injected');
    expect(sink.points[0].runId).toBe('run-A');
  });

  it('records a capture_meta event on connection loss instead of failing silently', async () => {
    subscriber.dropConnection('broker down during flood');
    await new Promise((r) => setImmediate(r));

    expect(sink.metaEvents).toHaveLength(1);
    expect(sink.metaEvents[0]).toMatchObject({
      event: 'disconnect',
      broker: 'plain',
      runId: 'run-1',
      reason: 'broker down during flood',
    });
  });
});
