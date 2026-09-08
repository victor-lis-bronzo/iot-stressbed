import { readFileSync } from 'fs';
import { Module, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ExperimentsModule } from '../experiments/experiments.module';
import { ExperimentsService } from '../experiments/experiments.service';
import { CaptureService } from './capture.service';
import {
  PLAIN_CAPTURE,
  PLAIN_MQTT_SUBSCRIBER,
  SECURE_CAPTURE,
  SECURE_MQTT_SUBSCRIBER,
  TELEMETRY_SINK,
} from './capture.tokens';
import {
  MosquittoSubscriberAdapter,
  MqttConnectionConfig,
} from './adapters/mosquitto-subscriber.adapter';
import { InfluxdbTelemetrySinkAdapter } from './adapters/influxdb-telemetry-sink.adapter';
import { MqttSubscriberPort } from './ports/mqtt-subscriber.port';
import { TelemetrySinkPort } from './ports/telemetry-sink.port';
import { BrokerLabel } from './ports/telemetry';

function readOptionalFile(path?: string): Buffer | undefined {
  return path ? readFileSync(path) : undefined;
}

function mqttSubscriberProvider(
  broker: BrokerLabel,
  token: symbol,
): Provider {
  const prefix = `CAPTURE_${broker.toUpperCase()}_MQTT`;
  return {
    provide: token,
    inject: [ConfigService],
    useFactory: (config: ConfigService) => {
      const tls = config.get<string>(`${prefix}_TLS`, 'false') === 'true';
      const connection: MqttConnectionConfig = {
        host: config.get<string>(`${prefix}_HOST`, 'localhost'),
        port: Number(config.get(`${prefix}_PORT`, tls ? 8883 : 1883)),
        tls,
        username: config.get<string>(`${prefix}_USERNAME`) || undefined,
        password: config.get<string>(`${prefix}_PASSWORD`) || undefined,
        ca: readOptionalFile(config.get<string>(`${prefix}_CA_PATH`)),
        cert: readOptionalFile(config.get<string>(`${prefix}_CERT_PATH`)),
        key: readOptionalFile(config.get<string>(`${prefix}_KEY_PATH`)),
        rejectUnauthorized:
          config.get<string>(`${prefix}_REJECT_UNAUTHORIZED`, 'true') !==
          'false',
        clientId: `stressbed-capture-${broker}-${Math.random()
          .toString(16)
          .slice(2, 10)}`,
      };
      return new MosquittoSubscriberAdapter(connection);
    },
  };
}

function captureProvider(
  broker: BrokerLabel,
  token: symbol,
  subscriberToken: symbol,
): Provider {
  return {
    provide: token,
    inject: [
      subscriberToken,
      TELEMETRY_SINK,
      ExperimentsService,
      EventEmitter2,
      ConfigService,
    ],
    useFactory: (
      subscriber: MqttSubscriberPort,
      sink: TelemetrySinkPort,
      experiments: ExperimentsService,
      events: EventEmitter2,
      config: ConfigService,
    ) =>
      new CaptureService(
        {
          broker,
          topicFilter: config.get<string>('CAPTURE_TOPIC', '#'),
          enabled: config.get<string>('CAPTURE_ENABLED', 'true') !== 'false',
        },
        subscriber,
        sink,
        experiments,
        events,
      ),
  };
}

const telemetrySinkProvider: Provider = {
  provide: TELEMETRY_SINK,
  inject: [ConfigService],
  useFactory: (config: ConfigService) =>
    new InfluxdbTelemetrySinkAdapter({
      url: config.get<string>(
        'INFLUXDB_URL',
        `http://localhost:${config.get('INFLUXDB_PORT', 8086)}`,
      ),
      token: config.get<string>('INFLUXDB_TOKEN', ''),
      org: config.get<string>('INFLUXDB_ORG', 'stressbed'),
      bucket: config.get<string>('INFLUXDB_BUCKET', 'stressbed'),
    }),
};

@Module({
  imports: [ConfigModule, ExperimentsModule],
  providers: [
    telemetrySinkProvider,
    mqttSubscriberProvider('plain', PLAIN_MQTT_SUBSCRIBER),
    mqttSubscriberProvider('secure', SECURE_MQTT_SUBSCRIBER),
    captureProvider('plain', PLAIN_CAPTURE, PLAIN_MQTT_SUBSCRIBER),
    captureProvider('secure', SECURE_CAPTURE, SECURE_MQTT_SUBSCRIBER),
  ],
})
export class CaptureModule {}
