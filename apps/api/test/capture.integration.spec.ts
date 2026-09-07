import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import mqtt from 'mqtt';
import { MosquittoSubscriberAdapter } from '../src/capture/adapters/mosquitto-subscriber.adapter';
import { RawMqttMessage } from '../src/capture/ports/mqtt-subscriber.port';

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

function waitForMessage(
  received: RawMqttMessage[],
  predicate: (m: RawMqttMessage) => boolean,
  timeoutMs = 8000,
): Promise<RawMqttMessage> {
  return new Promise((res, rej) => {
    const started = Date.now();
    const tick = setInterval(() => {
      const found = received.find(predicate);
      if (found) {
        clearInterval(tick);
        res(found);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(tick);
        rej(new Error('timed out waiting for message'));
      }
    }, 100);
  });
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
