import { brokerMetricsUrl, grafanaRunWindow, GRAFANA_WINDOW_MARGIN_MS } from './grafana';

const T0 = '2026-10-26T01:33:00.000Z';
const T1 = '2026-10-26T01:33:04.000Z';

describe('grafanaRunWindow', () => {
  it('uses the attack window of a finished Track B run, with the margin on both sides', () => {
    const window = grafanaRunWindow({ attackStartedAt: T0, attackFinishedAt: T1 }, null);
    expect(window).toEqual({
      from: String(Date.parse(T0) - GRAFANA_WINDOW_MARGIN_MS),
      to: String(Date.parse(T1) + GRAFANA_WINDOW_MARGIN_MS),
    });
  });

  it('prefers the attack window over an active run', () => {
    const window = grafanaRunWindow(
      { attackStartedAt: T0, attackFinishedAt: T1 },
      { startedAt: '2026-10-26T00:00:00.000Z' },
    );
    expect(window.from).toBe(String(Date.parse(T0) - GRAFANA_WINDOW_MARGIN_MS));
  });

  it('runs from the start of an active run until now', () => {
    expect(grafanaRunWindow(null, { startedAt: T0 })).toEqual({
      from: String(Date.parse(T0) - GRAFANA_WINDOW_MARGIN_MS),
      to: 'now',
    });
  });

  it('falls back to the last 15 minutes when there is nothing to anchor on', () => {
    expect(grafanaRunWindow(undefined, undefined)).toEqual({ from: 'now-15m', to: 'now' });
    expect(grafanaRunWindow({ attackStartedAt: null, attackFinishedAt: null }, null)).toEqual({
      from: 'now-15m',
      to: 'now',
    });
  });

  it('ignores an attack window that is incomplete or unparseable', () => {
    expect(grafanaRunWindow({ attackStartedAt: T0, attackFinishedAt: null }, null).from).toBe(
      'now-15m',
    );
    expect(grafanaRunWindow({ attackStartedAt: 'x', attackFinishedAt: 'y' }, null).from).toBe(
      'now-15m',
    );
  });
});

describe('brokerMetricsUrl', () => {
  it('builds the dashboard URL from the window and never carries a run_id', () => {
    const url = brokerMetricsUrl({ from: '1', to: 'now' }, 'http://g:3001');
    expect(url).toBe('http://g:3001/d/stressbed-broker-metrics/broker-metrics?from=1&to=now');
    expect(url).not.toContain('run_id');
  });
});
