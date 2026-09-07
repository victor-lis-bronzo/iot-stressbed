import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ExperimentsService } from '../experiments/experiments.service';
import {
  MQTT_SUBSCRIBER,
  TELEMETRY_CAPTURED,
  TELEMETRY_SINK,
} from './capture.tokens';
import { MqttSubscriberPort, RawMqttMessage } from './ports/mqtt-subscriber.port';
import { TelemetrySinkPort } from './ports/telemetry-sink.port';
import { BrokerLabel, TelemetryPoint } from './ports/telemetry';

@Injectable()
export class CaptureService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CaptureService.name);
  private readonly broker: BrokerLabel;
  private readonly topicFilter: string;
  private readonly enabled: boolean;

  constructor(
    @Inject(MQTT_SUBSCRIBER)
    private readonly subscriber: MqttSubscriberPort,
    @Inject(TELEMETRY_SINK)
    private readonly sink: TelemetrySinkPort,
    private readonly experiments: ExperimentsService,
    private readonly events: EventEmitter2,
    config: ConfigService,
  ) {
    this.broker = config.get<BrokerLabel>('CAPTURE_BROKER', 'plain');
    this.topicFilter = config.get<string>('CAPTURE_TOPIC', '#');
    this.enabled = config.get<string>('CAPTURE_ENABLED', 'true') !== 'false';
  }

  async onModuleInit() {
    if (!this.enabled) {
      this.logger.warn('capture disabled (CAPTURE_ENABLED=false)');
      return;
    }
    this.subscriber.onConnectionLost((reason) => {
      void this.handleConnectionLost(reason);
    });
    await this.subscriber.connect();
    await this.subscriber.subscribe(this.topicFilter, (msg) =>
      this.handleMessage(msg),
    );
    this.logger.log(
      `capturing ${this.topicFilter} from ${this.broker} broker`,
    );
  }

  async onModuleDestroy() {
    if (this.enabled) {
      await this.subscriber.disconnect();
    }
  }

  async handleMessage(message: RawMqttMessage): Promise<void> {
    const context = await this.experiments.resolveCaptureContext();
    const point = this.normalize(message, context.runId, context.source);
    await this.sink.writePoint(point);
    this.events.emit(TELEMETRY_CAPTURED, point);
  }

  private async handleConnectionLost(reason: string): Promise<void> {
    const { runId } = await this.experiments.resolveCaptureContext();
    this.logger.error(`broker connection lost: ${reason}`);
    await this.sink.writeMeta({
      event: 'disconnect',
      broker: this.broker,
      runId,
      reason,
      at: new Date(),
    });
  }

  private normalize(
    message: RawMqttMessage,
    runId: string | null,
    source: TelemetryPoint['source'],
  ): TelemetryPoint {
    const { temperature, humidity } = this.parseReadings(message.payload);
    return {
      sensorId: this.extractSensorId(message.topic),
      temperature,
      humidity,
      receivedAt: new Date(),
      broker: this.broker,
      runId,
      source,
      topic: message.topic,
      raw: message.payload,
    };
  }

  private extractSensorId(topic: string): string {
    const segments = topic.split('/').filter(Boolean);
    if (segments[0] === 'sensors' && segments[1]) {
      return segments[1];
    }
    return segments[segments.length - 1] ?? topic;
  }

  private parseReadings(payload: string): {
    temperature: number | null;
    humidity: number | null;
  } {
    try {
      const parsed = JSON.parse(payload);
      return {
        temperature: this.numericOrNull(parsed.temperature),
        humidity: this.numericOrNull(parsed.humidity),
      };
    } catch {
      return { temperature: null, humidity: null };
    }
  }

  private numericOrNull(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }
}
