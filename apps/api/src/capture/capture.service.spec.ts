import { EventEmitter2 } from '@nestjs/event-emitter';
import { ExperimentsService } from '../experiments/experiments.service';
import { CaptureService } from './capture.service';
import { TELEMETRY_CAPTURED } from './capture.tokens';
import { BrokerLabel, TelemetryPoint } from './ports/telemetry';
import { FakeMqttSubscriber } from './testing/fake-mqtt-subscriber';
import { FakeTelemetrySink } from './testing/fake-telemetry-sink';

describe('CaptureService', () => {
  let plainSubscriber: FakeMqttSubscriber;
  let secureSubscriber: FakeMqttSubscriber;
  let plainSink: FakeTelemetrySink;
  let secureSink: FakeTelemetrySink;
  let events: EventEmitter2;
  let experiments: { resolveCaptureContext: jest.Mock };
  let plain: CaptureService;
  let secure: CaptureService;

  function build(
    broker: BrokerLabel,
    subscriber: FakeMqttSubscriber,
    sink: FakeTelemetrySink,
  ): CaptureService {
    return new CaptureService(
      { broker, topicFilter: '#', enabled: true },
      subscriber,
      sink,
      experiments as unknown as ExperimentsService,
      events,
    );
  }

  beforeEach(async () => {
    plainSubscriber = new FakeMqttSubscriber();
    secureSubscriber = new FakeMqttSubscriber();
    plainSink = new FakeTelemetrySink();
    secureSink = new FakeTelemetrySink();
    events = new EventEmitter2();
    experiments = {
      resolveCaptureContext: jest
        .fn()
        .mockResolvedValue({ runId: 'run-1', source: 'legit' }),
    };
    plain = build('plain', plainSubscriber, plainSink);
    secure = build('secure', secureSubscriber, secureSink);
    await plain.onModuleInit();
    await secure.onModuleInit();
  });

  it('subscribes both brokers to # on init', () => {
    expect(plainSubscriber.connected).toBe(true);
    expect(secureSubscriber.connected).toBe(true);
  });

  it('normalizes and persists exactly the messages published, tagged correctly', async () => {
    await plainSubscriber.publish({
      topic: 'sensors/esp32-01/telemetry',
      payload: JSON.stringify({ temperature: 24.5, humidity: 60.2 }),
    });
    await plainSubscriber.publish({
      topic: 'sensors/esp32-02/telemetry',
      payload: JSON.stringify({ temperature: 19.1, humidity: 71 }),
    });

    expect(plainSink.points).toHaveLength(2);
    const [first] = plainSink.points;
    expect(first).toMatchObject<Partial<TelemetryPoint>>({
      sensorId: 'esp32-01',
      temperature: 24.5,
      humidity: 60.2,
      broker: 'plain',
      runId: 'run-1',
      source: 'legit',
    });
    expect(plainSink.points[1].sensorId).toBe('esp32-02');
  });

  it('emits one realtime event per captured message', async () => {
    const received: TelemetryPoint[] = [];
    events.on(TELEMETRY_CAPTURED, (p: TelemetryPoint) => received.push(p));

    await plainSubscriber.publish({
      topic: 'sensors/esp32-01/telemetry',
      payload: JSON.stringify({ temperature: 20, humidity: 50 }),
    });
    await plainSubscriber.publish({
      topic: 'sensors/esp32-01/telemetry',
      payload: JSON.stringify({ temperature: 21, humidity: 51 }),
    });

    expect(received).toHaveLength(2);
    expect(received).toEqual(plainSink.points);
  });

  it('records a malformed payload as raw with null readings', async () => {
    await plainSubscriber.publish({
      topic: 'sensors/esp32-01/telemetry',
      payload: 'not-json-garbage',
    });

    expect(plainSink.points).toHaveLength(1);
    expect(plainSink.points[0]).toMatchObject({
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
    await plainSubscriber.publish({
      topic: 'sensors/esp32-01/telemetry',
      payload: JSON.stringify({ temperature: 99, humidity: 1 }),
    });
    expect(plainSink.points[0].source).toBe('injected');
    expect(plainSink.points[0].runId).toBe('run-A');
  });

  it('records a capture_meta event on connection loss instead of failing silently', async () => {
    plainSubscriber.dropConnection('broker down during flood');
    await new Promise((r) => setImmediate(r));

    expect(plainSink.metaEvents).toHaveLength(1);
    expect(plainSink.metaEvents[0]).toMatchObject({
      event: 'disconnect',
      broker: 'plain',
      runId: 'run-1',
      reason: 'broker down during flood',
    });
    expect(secureSink.metaEvents).toHaveLength(0);
  });

  it('keeps the two broker streams independent: neither instance sees the other broker traffic', async () => {
    await plainSubscriber.publish({
      topic: 'sensors/esp32-01/telemetry',
      payload: JSON.stringify({ temperature: 24.5, humidity: 60.2 }),
    });
    await secureSubscriber.publish({
      topic: 'sensors/esp32-02/telemetry',
      payload: JSON.stringify({ temperature: 19.1, humidity: 71 }),
    });

    expect(plainSink.points).toHaveLength(1);
    expect(plainSink.points[0]).toMatchObject({
      sensorId: 'esp32-01',
      broker: 'plain',
    });
    expect(secureSink.points).toHaveLength(1);
    expect(secureSink.points[0]).toMatchObject({
      sensorId: 'esp32-02',
      broker: 'secure',
    });
  });

  it('emits both streams on the same event bus, each tagged with its own broker', async () => {
    const received: TelemetryPoint[] = [];
    events.on(TELEMETRY_CAPTURED, (p: TelemetryPoint) => received.push(p));

    await secureSubscriber.publish({
      topic: 'sensors/esp32-02/telemetry',
      payload: JSON.stringify({ temperature: 19.1, humidity: 71 }),
    });
    await plainSubscriber.publish({
      topic: 'sensors/esp32-01/telemetry',
      payload: JSON.stringify({ temperature: 24.5, humidity: 60.2 }),
    });

    expect(received.map((p) => p.broker)).toEqual(['secure', 'plain']);
  });

  it('disconnects each subscriber independently on shutdown', async () => {
    await plain.onModuleDestroy();

    expect(plainSubscriber.connected).toBe(false);
    expect(secureSubscriber.connected).toBe(true);

    await secure.onModuleDestroy();
    expect(secureSubscriber.connected).toBe(false);
  });
});
