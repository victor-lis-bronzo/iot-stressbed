import { CaptureMetaEvent, TelemetryPoint } from '../ports/telemetry';
import { TelemetrySinkPort } from '../ports/telemetry-sink.port';

export class FakeTelemetrySink implements TelemetrySinkPort {
  readonly points: TelemetryPoint[] = [];
  readonly metaEvents: CaptureMetaEvent[] = [];

  async writePoint(point: TelemetryPoint): Promise<void> {
    this.points.push(point);
  }

  async writeMeta(event: CaptureMetaEvent): Promise<void> {
    this.metaEvents.push(event);
  }

  async close(): Promise<void> {}
}
