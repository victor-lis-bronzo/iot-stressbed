import { Logger } from '@nestjs/common';
import { InfluxDB, Point, WriteApi } from '@influxdata/influxdb-client';
import { CaptureMetaEvent, TelemetryPoint } from '../ports/telemetry';
import { TelemetrySinkPort } from '../ports/telemetry-sink.port';

export interface InfluxSinkConfig {
  url: string;
  token: string;
  org: string;
  bucket: string;
}

export class InfluxdbTelemetrySinkAdapter implements TelemetrySinkPort {
  private readonly logger = new Logger(InfluxdbTelemetrySinkAdapter.name);
  private readonly writeApi: WriteApi;

  constructor(config: InfluxSinkConfig) {
    this.writeApi = new InfluxDB({
      url: config.url,
      token: config.token,
    }).getWriteApi(config.org, config.bucket, 'ms', {
      writeFailed: (error, lines, attempt) => {
        this.logger.error(
          `InfluxDB write failed (attempt ${attempt}, ${lines.length} line(s)): ${error}`,
        );
      },
      writeSuccess: (lines) => {
        this.logger.debug(`InfluxDB write succeeded (${lines.length} line(s))`);
      },
    });
  }

  async writePoint(point: TelemetryPoint): Promise<void> {
    const influxPoint = new Point('telemetry')
      .tag('run_id', point.runId ?? 'none')
      .tag('sensor_id', point.sensorId)
      .tag('broker', point.broker)
      .tag('source', point.source)
      .stringField('raw', point.raw)
      .timestamp(point.receivedAt);

    if (point.temperature !== null) {
      influxPoint.floatField('temperature', point.temperature);
    }
    if (point.humidity !== null) {
      influxPoint.floatField('humidity', point.humidity);
    }

    this.writeApi.writePoint(influxPoint);
  }

  async writeMeta(event: CaptureMetaEvent): Promise<void> {
    this.writeApi.writePoint(
      new Point('capture_meta')
        .tag('run_id', event.runId ?? 'none')
        .tag('broker', event.broker)
        .tag('event', event.event)
        .stringField('reason', event.reason)
        .timestamp(event.at),
    );
  }

  async close(): Promise<void> {
    await this.writeApi.close();
  }
}
