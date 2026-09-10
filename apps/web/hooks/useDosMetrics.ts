'use client';

import { useQuery } from '@tanstack/react-query';
import { useApi } from './useApi';

export type TrackBAttackType = 'connection-flood' | 'message-flood' | 'malformed-payload';

/**
 * Shape bruto de saída de cada script do attacker (attacker/python/*.py),
 * persistido tal como veio pelo backend (apps/api/src/metrics). Os campos
 * variam por `trackBAttackType` e não são garantidos — trate como dados
 * opcionais, nunca assuma presença.
 */
export interface TrackBResult {
  target?: 'plain' | 'secure';
  host?: string;
  port?: number;
  started_at?: string;
  finished_at?: string;
  // connection-flood
  connections_attempted?: number;
  connections_established?: number;
  connections_rejected?: number;
  success_rate?: number | null;
  errors?: string[];
  // message-flood
  topic?: string;
  connect_status?: 'connected' | 'rejected';
  connect_error?: string | null;
  attempted?: number;
  accepted?: number;
  elapsed_seconds?: number;
  achieved_rate?: number;
  // malformed-payload
  mode?: 'giant' | 'invalid-utf8' | 'invalid-json' | 'null-bytes';
  publish_accepted?: number;
  disconnected_after_publish?: boolean;
  broker_response_summary?: string;
}

export interface RunKpi {
  id: string;
  runId: string;
  interceptionCoveragePct: number | null;
  entropyBits: number | null;
  payloadReadabilityClassification: 'legivel' | 'ciphertext' | 'inconclusivo' | null;
  injectionSuccessRatePct: number | null;
  injectionConnectStatus: 'connected' | 'rejected' | null;
  timeToFirstCaptureMs: number | null;
  trackBAttackType: TrackBAttackType | null;
  trackBResult: TrackBResult | null;
  attackStartedAt: string | null;
  attackFinishedAt: string | null;
  calculatedAt: string;
}

export function useDosRunResult(runId: string | undefined) {
  const api = useApi();

  return useQuery({
    queryKey: ['metrics', 'runs', runId],
    queryFn: async () => {
      const response = await api.get<RunKpi | null>(`/metrics/runs/${runId}`);
      return response.data;
    },
    enabled: !!runId,
    // Para de fazer polling assim que o resultado do ataque já foi persistido.
    refetchInterval: (query) => (query.state.data?.trackBResult ? false : 3000),
  });
}

export function useDosRunHistory() {
  const api = useApi();

  return useQuery({
    queryKey: ['metrics', 'runs'],
    queryFn: async () => {
      const response = await api.get<RunKpi[]>('/metrics/runs');
      return response.data.filter((kpi) => kpi.trackBAttackType != null);
    },
    // Uma run é normalmente encerrada pelo próprio run-experiment.sh via CLI,
    // fora desta UI — sem polling, o histórico nunca refletiria o resultado de
    // um ataque que acabou de terminar (mesmo motivo do polling em useActiveRun).
    refetchInterval: 5000,
  });
}
