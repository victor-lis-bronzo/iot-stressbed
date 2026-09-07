import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ExperimentsService } from '../experiments/experiments.service';
import { TELEMETRY_CAPTURED } from './capture.tokens';
import { MqttSubscriberPort, RawMqttMessage } from './ports/mqtt-subscriber.port';
import { TelemetrySinkPort } from './ports/telemetry-sink.port';
import { BrokerLabel, TelemetryPoint } from './ports/telemetry';

export interface CaptureOptions {
  broker: BrokerLabel;
  topicFilter: string;
  enabled: boolean;
}

export class CaptureService implements OnModuleInit, OnModuleDestroy {
  private readonly logger: Logger;

  constructor(
    private readonly options: CaptureOptions,
    private readonly subscriber: MqttSubscriberPort,
    private readonly sink: TelemetrySinkPort,
    private readonly experiments: ExperimentsService,
    private readonly events: EventEmitter2,
  ) {
    this.logger = new Logger(`${CaptureService.name}:${options.broker}`);
  }

  async onModuleInit() {
    if (!this.options.enabled) {
      this.logger.warn('capture disabled (CAPTURE_ENABLED=false)');
      return;
    }
    this.subscriber.onConnectionLost((reason) => {
      void this.handleConnectionLost(reason);
    });
    await this.subscriber.connect();
    await this.subscriber.subscribe(this.options.topicFilter, (msg) =>
      this.handleMessage(msg),
    );
    this.logger.log(
      `capturing ${this.options.topicFilter} from ${this.options.broker} broker`,
    );
  }

  async onModuleDestroy() {
    if (this.options.enabled) {
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
      broker: this.options.broker,
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
      broker: this.options.broker,
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
