import { BrokerLabel, TelemetrySource } from '../../capture/ports/telemetry';
import { TelemetryQueryPort } from '../ports/telemetry-query.port';

interface FakeEntry {
  count: number;
  firstTimestamp: Date | null;
}

export class FakeTelemetryQuery implements TelemetryQueryPort {
  private readonly entries = new Map<string, FakeEntry>();

  private key(runId: string, broker: BrokerLabel, source?: TelemetrySource): string {
    return [runId, broker, source ?? '*'].join('::');
  }

  seed(
    runId: string,
    broker: BrokerLabel,
    entry: Partial<FakeEntry>,
    source?: TelemetrySource,
  ): void {
    this.entries.set(this.key(runId, broker, source), {
      count: entry.count ?? 0,
      firstTimestamp: entry.firstTimestamp ?? null,
    });
  }

  async countCapturedPoints(
    runId: string,
    broker: BrokerLabel,
    source?: TelemetrySource,
  ): Promise<number> {
    return this.entries.get(this.key(runId, broker, source))?.count ?? 0;
  }

  async firstPointTimestamp(
    runId: string,
    broker: BrokerLabel,
  ): Promise<Date | null> {
    return this.entries.get(this.key(runId, broker))?.firstTimestamp ?? null;
  }
}
