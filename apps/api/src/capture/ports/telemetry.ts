export type BrokerLabel = 'plain' | 'secure';
export type TelemetrySource = 'legit' | 'injected';

export interface TelemetryPoint {
  sensorId: string;
  temperature: number | null;
  humidity: number | null;
  receivedAt: Date;
  broker: BrokerLabel;
  runId: string | null;
  source: TelemetrySource;
  topic: string;
  raw: string;
}

export interface CaptureMetaEvent {
  event: 'disconnect';
  broker: BrokerLabel;
  runId: string | null;
  reason: string;
  at: Date;
}
