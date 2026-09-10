'use client';

import { useActiveRun } from '@/hooks/useExperimentRuns';
import { useDosRunHistory, useDosRunResult, type RunKpi } from '@/hooks/useDosMetrics';
import { GRAFANA_URL } from '@/lib/api';

function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${(value * 100).toFixed(1)}%`;
}

function ResultFields({ kpi }: { kpi: RunKpi }) {
  const result = kpi.trackBResult;
  if (!result) {
    return <p className="text-sm text-muted">Aguardando resultado do ataque...</p>;
  }

  const rows: [string, string][] = [];
  if (kpi.trackBAttackType === 'connection-flood') {
    rows.push(
      ['Conexões tentadas', String(result.connections_attempted ?? '—')],
      ['Conexões estabelecidas', String(result.connections_established ?? '—')],
      ['Conexões rejeitadas', String(result.connections_rejected ?? '—')],
      ['Taxa de sucesso', formatPercent(result.success_rate)],
    );
  } else if (kpi.trackBAttackType === 'message-flood') {
    rows.push(
      ['Status da conexão', result.connect_status ?? '—'],
      ['Mensagens tentadas', String(result.attempted ?? '—')],
      ['Mensagens aceitas', String(result.accepted ?? '—')],
      ['Taxa de sucesso', formatPercent(result.success_rate)],
      ['Taxa alcançada (msg/s)', String(result.achieved_rate ?? '—')],
    );
  } else if (kpi.trackBAttackType === 'malformed-payload') {
    rows.push(
      ['Modo do payload', result.mode ?? '—'],
      ['Status da conexão', result.connect_status ?? '—'],
      ['Publicações aceitas', String(result.publish_accepted ?? '—')],
      ['Desconectou após publish', result.disconnected_after_publish ? 'Sim' : 'Não'],
      ['Resposta do broker', result.broker_response_summary ?? '—'],
    );
  }

  return (
    <dl className="grid grid-cols-2 gap-3 text-sm">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-muted">{label}</dt>
          <dd className="font-mono text-primary">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function AttackResult() {
  const { data: activeRun } = useActiveRun();
  const { data: history } = useDosRunHistory();

  const relevantRunId =
    activeRun && activeRun.attackType !== 'injection' ? activeRun.id : history?.[0]?.runId;

  const { data: kpi, isPending } = useDosRunResult(relevantRunId);

  return (
    <div className="bg-panel border border-border rounded p-6 mb-8">
      <h3 className="text-lg font-medium text-primary mb-4">Resultado mais recente</h3>

      {!relevantRunId ? (
        <p className="text-sm text-muted">Nenhuma run de Track B ainda.</p>
      ) : isPending ? (
        <p className="text-sm text-muted">Carregando...</p>
      ) : !kpi ? (
        <p className="text-sm text-muted">Aguardando resultado do ataque...</p>
      ) : (
        <ResultFields kpi={kpi} />
      )}

      {relevantRunId ? (
        <a
          href={`${GRAFANA_URL}/d/stressbed-broker-metrics/broker-metrics?var-run_id=${relevantRunId}&from=now-15m&to=now`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-block text-sm text-muted hover:text-primary underline"
        >
          Ver métricas do broker no Grafana ↗
        </a>
      ) : null}
    </div>
  );
}
