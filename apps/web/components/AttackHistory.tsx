'use client';

import { useDosRunHistory } from '@/hooks/useDosMetrics';

export default function AttackHistory() {
  const { data: history, isPending } = useDosRunHistory();

  return (
    <div className="bg-panel border border-border rounded overflow-hidden">
      <div className="px-4 py-5 border-b border-border sm:px-6">
        <h3 className="text-lg leading-6 font-medium text-primary">Histórico de execuções (Track B)</h3>
      </div>

      {isPending ? (
        <div className="p-6 text-center text-muted">Carregando...</div>
      ) : !history || history.length === 0 ? (
        <div className="p-6 text-center text-muted">Nenhuma execução registrada.</div>
      ) : (
        <ul className="divide-y divide-border">
          {history.map((kpi) => (
            <li key={kpi.runId} className="px-4 py-4 sm:px-6 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-primary">{kpi.trackBAttackType}</p>
                <p className="text-xs text-muted mt-1 font-mono">{kpi.runId}</p>
              </div>
              <div className="text-right text-xs text-muted">
                <p>
                  {kpi.attackStartedAt ? new Date(kpi.attackStartedAt).toLocaleString() : '—'}
                </p>
                <p>
                  {kpi.trackBResult ? 'Resultado registrado' : 'Aguardando resultado'}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
