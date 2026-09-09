import { BrokerLabel, TelemetrySource } from '../../capture/ports/telemetry';

export interface TelemetryQueryPort {
  countCapturedPoints(
    runId: string,
    broker: BrokerLabel,
    source?: TelemetrySource,
  ): Promise<number>;

  firstPointTimestamp(
    runId: string,
    broker: BrokerLabel,
  ): Promise<Date | null>;
}
