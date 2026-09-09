import { InfluxDB, QueryApi } from '@influxdata/influxdb-client';
import { BrokerLabel, TelemetrySource } from '../../capture/ports/telemetry';
import { TelemetryQueryPort } from '../ports/telemetry-query.port';

export interface InfluxQueryConfig {
  url: string;
  token: string;
  org: string;
  bucket: string;
}

interface FluxCountRow {
  _value: number;
}

interface FluxTimeRow {
  _time: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertSafeRunId(runId: string): void {
  if (!UUID_RE.test(runId)) {
    throw new Error(`invalid runId for Flux query: ${runId}`);
  }
}

export class InfluxdbTelemetryQueryAdapter implements TelemetryQueryPort {
  private readonly queryApi: QueryApi;
  private readonly bucket: string;

  constructor(config: InfluxQueryConfig) {
    this.queryApi = new InfluxDB({
      url: config.url,
      token: config.token,
    }).getQueryApi(config.org);
    this.bucket = config.bucket;
  }

  async countCapturedPoints(
    runId: string,
    broker: BrokerLabel,
    source?: TelemetrySource,
  ): Promise<number> {
    assertSafeRunId(runId);
    const sourceFilter = source
      ? `|> filter(fn: (r) => r.source == "${source}")`
      : '';
    const flux = `
      from(bucket: "${this.bucket}")
        |> range(start: 0)
        |> filter(fn: (r) => r._measurement == "telemetry")
        |> filter(fn: (r) => r.run_id == "${runId}")
        |> filter(fn: (r) => r.broker == "${broker}")
        ${sourceFilter}
        |> filter(fn: (r) => r._field == "raw")
        |> count()
    `;
    const rows = await this.queryApi.collectRows<FluxCountRow>(flux);
    return rows.reduce((sum, row) => sum + (row._value ?? 0), 0);
  }

  async firstPointTimestamp(
    runId: string,
    broker: BrokerLabel,
  ): Promise<Date | null> {
    assertSafeRunId(runId);
    const flux = `
      from(bucket: "${this.bucket}")
        |> range(start: 0)
        |> filter(fn: (r) => r._measurement == "telemetry")
        |> filter(fn: (r) => r.run_id == "${runId}")
        |> filter(fn: (r) => r.broker == "${broker}")
        |> filter(fn: (r) => r._field == "raw")
        |> sort(columns: ["_time"])
        |> limit(n: 1)
    `;
    const rows = await this.queryApi.collectRows<FluxTimeRow>(flux);
    return rows.length ? new Date(rows[0]._time) : null;
  }
}
