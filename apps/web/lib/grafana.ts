import { GRAFANA_URL } from '@/lib/api';

/** Folga antes/depois da run no gráfico (igual ao export_grafana.sh). */
export const GRAFANA_WINDOW_MARGIN_MS = 10_000;

export interface GrafanaWindow {
  from: string;
  to: string;
}

interface WindowKpi {
  attackStartedAt?: string | null;
  attackFinishedAt?: string | null;
}

interface WindowRun {
  startedAt?: string | null;
}

/**
 * Janela de tempo do dashboard de métricas do broker para uma run. O dashboard
 * não filtra mais por run_id (ADR-0013): a janela [início, fim] é o que isola a
 * run, e só existe uma ativa por vez (ADR-0006).
 *
 * Prioridade: janela do ataque (KPI de Track B, já finalizado) > run ainda ativa
 * (do início até agora) > últimos 15 min.
 */
export function grafanaRunWindow(
  kpi: WindowKpi | null | undefined,
  activeRun: WindowRun | null | undefined,
): GrafanaWindow {
  const margin = GRAFANA_WINDOW_MARGIN_MS;
  const start = kpi?.attackStartedAt ? Date.parse(kpi.attackStartedAt) : NaN;
  const end = kpi?.attackFinishedAt ? Date.parse(kpi.attackFinishedAt) : NaN;
  if (Number.isFinite(start) && Number.isFinite(end)) {
    return { from: String(start - margin), to: String(end + margin) };
  }

  const activeStart = activeRun?.startedAt ? Date.parse(activeRun.startedAt) : NaN;
  if (Number.isFinite(activeStart)) {
    return { from: String(activeStart - margin), to: 'now' };
  }

  return { from: 'now-15m', to: 'now' };
}

export function brokerMetricsUrl(window: GrafanaWindow, baseUrl: string = GRAFANA_URL): string {
  return `${baseUrl}/d/stressbed-broker-metrics/broker-metrics?from=${window.from}&to=${window.to}`;
}
