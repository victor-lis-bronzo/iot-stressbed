import { readFileSync } from 'fs';
import { Module, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ExperimentsModule } from '../experiments/experiments.module';
import { CaptureService } from './capture.service';
import { MQTT_SUBSCRIBER, TELEMETRY_SINK } from './capture.tokens';
import {
  MosquittoSubscriberAdapter,
  MqttConnectionConfig,
} from './adapters/mosquitto-subscriber.adapter';
import { InfluxdbTelemetrySinkAdapter } from './adapters/influxdb-telemetry-sink.adapter';

function readOptionalFile(path?: string): Buffer | undefined {
  return path ? readFileSync(path) : undefined;
}

const mqttSubscriberProvider: Provider = {
  provide: MQTT_SUBSCRIBER,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    const tls = config.get<string>('CAPTURE_MQTT_TLS', 'false') === 'true';
    const connection: MqttConnectionConfig = {
      host: config.get<string>('CAPTURE_MQTT_HOST', 'localhost'),
      port: Number(config.get('CAPTURE_MQTT_PORT', tls ? 8883 : 1883)),
      tls,
      username: config.get<string>('CAPTURE_MQTT_USERNAME') || undefined,
      password: config.get<string>('CAPTURE_MQTT_PASSWORD') || undefined,
      ca: readOptionalFile(config.get<string>('CAPTURE_MQTT_CA_PATH')),
      cert: readOptionalFile(config.get<string>('CAPTURE_MQTT_CERT_PATH')),
      key: readOptionalFile(config.get<string>('CAPTURE_MQTT_KEY_PATH')),
      rejectUnauthorized:
        config.get<string>('CAPTURE_MQTT_REJECT_UNAUTHORIZED', 'true') !==
        'false',
    };
    return new MosquittoSubscriberAdapter(connection);
  },
};

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
  providers: [CaptureService, mqttSubscriberProvider, telemetrySinkProvider],
})
export class CaptureModule {}
