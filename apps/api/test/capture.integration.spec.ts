import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import mqtt from 'mqtt';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MosquittoSubscriberAdapter } from '../src/capture/adapters/mosquitto-subscriber.adapter';
import { CaptureService } from '../src/capture/capture.service';
import { TELEMETRY_CAPTURED } from '../src/capture/capture.tokens';
import { RawMqttMessage } from '../src/capture/ports/mqtt-subscriber.port';
import { BrokerLabel, TelemetryPoint } from '../src/capture/ports/telemetry';
import { ExperimentsService } from '../src/experiments/experiments.service';
import { FakeTelemetrySink } from '../src/capture/testing/fake-telemetry-sink';

const ROOT = resolve(__dirname, '../../..');
const CERT_DIR = resolve(ROOT, 'infra/mosquitto/secure/certs');

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = { ...process.env } as Record<
    string,
    string
  >;
  const envPath = resolve(ROOT, '.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && env[match[1]] === undefined) {
        env[match[1]] = match[2].trim();
      }
    }
  }
  return env;
}

const env = loadEnv();

function waitUntil(
  condition: () => boolean,
  timeoutMs = 8000,
): Promise<void> {
  return new Promise((res, rej) => {
    const started = Date.now();
    const tick = setInterval(() => {
      if (condition()) {
        clearInterval(tick);
        res();
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(tick);
        rej(new Error('timed out waiting for message'));
      }
    }, 100);
  });
}

async function waitForMessage(
  received: RawMqttMessage[],
  predicate: (m: RawMqttMessage) => boolean,
): Promise<RawMqttMessage> {
  await waitUntil(() => received.some(predicate));
  return received.find(predicate) as RawMqttMessage;
}

describe('Mosquitto adapter integration (real brokers via docker compose)', () => {
  it('connects to the PLAIN broker, subscribes and receives a published message', async () => {
    const received: RawMqttMessage[] = [];
    const adapter = new MosquittoSubscriberAdapter({
      host: 'localhost',
      port: Number(env.MQTT_PLAIN_PORT ?? 1883),
      tls: false,
    });
    await adapter.connect();
    await adapter.subscribe('sensors/#', (m) => { received.push(m); });

    const topic = 'sensors/itest-plain/telemetry';
    const payload = JSON.stringify({ temperature: 25, humidity: 55 });
    const pub = await mqtt.connectAsync(`mqtt://localhost:${env.MQTT_PLAIN_PORT ?? 1883}`);
    await pub.publishAsync(topic, payload);

    const msg = await waitForMessage(received, (m) => m.topic === topic);
    expect(msg.payload).toBe(payload);

    await pub.endAsync();
    await adapter.disconnect();
  });

  it('connects to the SECURE broker with mTLS + password and receives a message', async () => {
    const tlsOpts = {
      ca: readFileSync(resolve(CERT_DIR, 'ca.crt')),
      cert: readFileSync(resolve(CERT_DIR, 'client-capture.crt')),
      key: readFileSync(resolve(CERT_DIR, 'client-capture.key')),
    };
    const received: RawMqttMessage[] = [];
    const adapter = new MosquittoSubscriberAdapter({
      host: 'localhost',
      port: Number(env.MQTT_SECURE_PORT ?? 8883),
      tls: true,
      username: env.MQTT_SECURE_USERNAME,
      password: env.MQTT_SECURE_PASSWORD,
      ...tlsOpts,
    });
    await adapter.connect();
    await adapter.subscribe('#', (m) => { received.push(m); });

    const topic = 'sensors/itest-secure/telemetry';
    const payload = JSON.stringify({ temperature: 26, humidity: 56 });
    const pub = await mqtt.connectAsync(`mqtts://localhost:${env.MQTT_SECURE_PORT ?? 8883}`, {
      username: env.MQTT_SECURE_USERNAME,
      password: env.MQTT_SECURE_PASSWORD,
      ca: tlsOpts.ca,
      cert: readFileSync(resolve(CERT_DIR, 'client-test.crt')),
      key: readFileSync(resolve(CERT_DIR, 'client-test.key')),
    });
    await pub.publishAsync(topic, payload);

    const msg = await waitForMessage(received, (m) => m.topic === topic);
    expect(msg.payload).toBe(payload);

    await pub.endAsync();
    await adapter.disconnect();
  });

  it('is refused by the SECURE broker without a client certificate (mTLS enforced)', async () => {
    await expect(
      mqtt.connectAsync(
        `mqtts://localhost:${env.MQTT_SECURE_PORT ?? 8883}`,
        {
          username: env.MQTT_SECURE_USERNAME,
          password: env.MQTT_SECURE_PASSWORD,
          ca: readFileSync(resolve(CERT_DIR, 'ca.crt')),
          rejectUnauthorized: true,
          connectTimeout: 5000,
        },
      ),
    ).rejects.toBeDefined();
  });
});

describe('Dual capture integration (plain and secure at the same time)', () => {
  const secureCerts = {
    ca: readFileSync(resolve(CERT_DIR, 'ca.crt')),
    cert: readFileSync(resolve(CERT_DIR, 'client-capture.crt')),
    key: readFileSync(resolve(CERT_DIR, 'client-capture.key')),
  };
  const plainPort = Number(env.MQTT_PLAIN_PORT ?? 1883);
  const securePort = Number(env.MQTT_SECURE_PORT ?? 8883);

  const experiments = {
    resolveCaptureContext: async () => ({ runId: 'run-itest', source: 'legit' }),
  } as unknown as ExperimentsService;

  function captureFor(broker: BrokerLabel, sink: FakeTelemetrySink, events: EventEmitter2) {
    const subscriber =
      broker === 'plain'
        ? new MosquittoSubscriberAdapter({ host: 'localhost', port: plainPort, tls: false })
        : new MosquittoSubscriberAdapter({
            host: 'localhost',
            port: securePort,
            tls: true,
            username: env.MQTT_SECURE_USERNAME,
            password: env.MQTT_SECURE_PASSWORD,
            ...secureCerts,
          });
    return new CaptureService(
      { broker, topicFilter: '#', enabled: true },
      subscriber,
      sink,
      experiments,
      events,
    );
  }

  it('captures each broker into its own stream, tagged and without cross-talk', async () => {
    const events = new EventEmitter2();
    const broadcast: TelemetryPoint[] = [];
    events.on(TELEMETRY_CAPTURED, (p: TelemetryPoint) => broadcast.push(p));

    const plainSink = new FakeTelemetrySink();
    const secureSink = new FakeTelemetrySink();
    const plain = captureFor('plain', plainSink, events);
    const secure = captureFor('secure', secureSink, events);
    await plain.onModuleInit();
    await secure.onModuleInit();

    const plainPub = await mqtt.connectAsync(`mqtt://localhost:${plainPort}`);
    const securePub = await mqtt.connectAsync(`mqtts://localhost:${securePort}`, {
      username: env.MQTT_SECURE_USERNAME,
      password: env.MQTT_SECURE_PASSWORD,
      ca: secureCerts.ca,
      cert: readFileSync(resolve(CERT_DIR, 'client-test.crt')),
      key: readFileSync(resolve(CERT_DIR, 'client-test.key')),
    });

    await plainPub.publishAsync(
      'sensors/itest-dual-plain/telemetry',
      JSON.stringify({ temperature: 25, humidity: 55 }),
    );
    await securePub.publishAsync(
      'sensors/itest-dual-secure/telemetry',
      JSON.stringify({ temperature: 26, humidity: 56 }),
    );

    try {
      await waitUntil(
        () =>
          plainSink.points.some((p) => p.sensorId === 'itest-dual-plain') &&
          secureSink.points.some((p) => p.sensorId === 'itest-dual-secure'),
      );

      expect(plainSink.points.every((p) => p.broker === 'plain')).toBe(true);
      expect(secureSink.points.every((p) => p.broker === 'secure')).toBe(true);
      expect(plainSink.points.some((p) => p.sensorId === 'itest-dual-secure')).toBe(false);
      expect(secureSink.points.some((p) => p.sensorId === 'itest-dual-plain')).toBe(false);

      expect(broadcast.find((p) => p.sensorId === 'itest-dual-plain')).toMatchObject({
        broker: 'plain',
        runId: 'run-itest',
        temperature: 25,
      });
      expect(broadcast.find((p) => p.sensorId === 'itest-dual-secure')).toMatchObject({
        broker: 'secure',
        runId: 'run-itest',
        temperature: 26,
      });
    } finally {
      await plainPub.endAsync();
      await securePub.endAsync();
      await plain.onModuleDestroy();
      await secure.onModuleDestroy();
    }
  });
});
