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

export interface StartAttackPayload {
  track: 'injection' | 'connection-flood' | 'message-flood' | 'malformed-payload';
  mode: 'plain' | 'secure';
  args?: string[];
}

export function useStartAttack() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: StartAttackPayload) => {
      const response = await api.post<ExperimentRun>('/experiments/attacks/start', payload);
      return response.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ACTIVE_RUN_KEY }),
  });
}

export function useStopRun() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      // Vai para /experiments/attacks/stop (superset de /experiments/runs/stop:
      // também mata o processo do script gerenciado no container attacker, se
      // houver um; é no-op seguro quando não há nada gerenciado) — ver
      // docs/specs/attacker-managed-execution.md.
      const response = await api.post<ExperimentRun | null>('/experiments/attacks/stop');
      return response.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ACTIVE_RUN_KEY }),
  });
}
