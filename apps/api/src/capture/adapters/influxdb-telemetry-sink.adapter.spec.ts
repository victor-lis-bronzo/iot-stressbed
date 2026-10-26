import {
  InfluxdbTelemetrySinkAdapter,
  InfluxSinkConfig,
} from './influxdb-telemetry-sink.adapter';

// Mocka a lib para não exigir um InfluxDB real: só queremos observar com quais
// opções de escrita o WriteApi é construído (foco no fio do flushInterval).
const getWriteApi = jest.fn();
const writeApiStub = { writePoint: jest.fn(), close: jest.fn() };

jest.mock('@influxdata/influxdb-client', () => {
  const actual = jest.requireActual('@influxdata/influxdb-client');
  return {
    ...actual,
    InfluxDB: jest.fn().mockImplementation(() => ({
      getWriteApi: (...args: unknown[]) => getWriteApi(...args),
    })),
  };
});

function build(config: Partial<InfluxSinkConfig>): void {
  new InfluxdbTelemetrySinkAdapter({
    url: 'http://localhost:8086',
    token: 'token',
    org: 'stressbed',
    bucket: 'stressbed',
    ...config,
  });
}

function writeOptionsFromLastCall(): Record<string, unknown> {
  const call = getWriteApi.mock.calls.at(-1);
  expect(call).toBeDefined();
  // getWriteApi(org, bucket, precision, writeOptions)
  return call![3] as Record<string, unknown>;
}

describe('InfluxdbTelemetrySinkAdapter flushInterval wiring', () => {
  beforeEach(() => {
    getWriteApi.mockReset();
    getWriteApi.mockReturnValue(writeApiStub);
  });

  it('passa flushInterval quando flushIntervalMs é um número positivo', () => {
    build({ flushIntervalMs: 250 });

    const options = writeOptionsFromLastCall();
    expect(options.flushInterval).toBe(250);
  });

  it('usa precisão "ns" e mantém os callbacks writeFailed/writeSuccess', () => {
    build({ flushIntervalMs: 250 });

    const call = getWriteApi.mock.calls.at(-1)!;
    expect(call[2]).toBe('ns');
    const options = writeOptionsFromLastCall();
    expect(typeof options.writeFailed).toBe('function');
    expect(typeof options.writeSuccess).toBe('function');
  });

  it('não define flushInterval quando flushIntervalMs é undefined (default de 60s da lib)', () => {
    build({ flushIntervalMs: undefined });

    const options = writeOptionsFromLastCall();
    expect(options).not.toHaveProperty('flushInterval');
  });

  it.each([0, -1, Number.NaN])(
    'não define flushInterval para valor inválido (%p)',
    (value) => {
      build({ flushIntervalMs: value });

      const options = writeOptionsFromLastCall();
      expect(options).not.toHaveProperty('flushInterval');
    },
  );
});
