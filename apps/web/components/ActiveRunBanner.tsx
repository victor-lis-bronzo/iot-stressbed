'use client';

import { useActiveRun, useStopRun } from '@/hooks/useExperimentRuns';

export default function ActiveRunBanner() {
  const { data: activeRun } = useActiveRun();
  const stopRun = useStopRun();

  if (!activeRun) {
    return null;
  }

  return (
    <div className="mb-6 flex items-center justify-between rounded border border-critical bg-critical/10 p-4">
      <div>
        <p className="text-sm font-semibold text-critical">
          Run ativa: {activeRun.attackType} contra {activeRun.mode}
        </p>
        <p className="mt-1 text-xs text-muted">
          Iniciada em {new Date(activeRun.startedAt).toLocaleTimeString()}
        </p>
      </div>
      <button
        onClick={() => stopRun.mutate()}
        disabled={stopRun.isPending}
        className="rounded border border-critical px-3 py-1.5 text-sm font-medium text-critical hover:bg-critical/10 disabled:opacity-50"
      >
        {stopRun.isPending ? 'Encerrando...' : 'Parar run'}
      </button>
    </div>
  );
}
