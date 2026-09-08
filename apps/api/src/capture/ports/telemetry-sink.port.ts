import { CaptureMetaEvent, TelemetryPoint } from './telemetry';

export interface TelemetrySinkPort {
  writePoint(point: TelemetryPoint): Promise<void>;
  writeMeta(event: CaptureMetaEvent): Promise<void>;
  close(): Promise<void>;
}
