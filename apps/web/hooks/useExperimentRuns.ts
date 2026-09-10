'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from './useApi';

export interface ExperimentRun {
  id: string;
  mode: 'plain' | 'secure';
  attackType: string;
  params: Record<string, unknown> | null;
  startedAt: string;
  endedAt: string | null;
  notes: string | null;
}

const ACTIVE_RUN_KEY = ['experiments', 'runs', 'active'];

export function useActiveRun() {
  const api = useApi();

  return useQuery({
    queryKey: ACTIVE_RUN_KEY,
    queryFn: async () => {
      const response = await api.get<ExperimentRun | null>('/experiments/runs/active');
      return response.data;
    },
    // Não existe WebSocket de ciclo de vida de run (só de telemetria) — polling
    // curto é a única forma de a UI perceber que um ataque disparado via CLI
    // começou ou terminou.
    refetchInterval: 4000,
  });
}

export function useStopRun() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await api.post<ExperimentRun | null>('/experiments/runs/stop');
      return response.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ACTIVE_RUN_KEY }),
  });
}
