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

export interface LaunchRunInput {
  mode: 'plain' | 'secure';
  attackType: 'injection' | 'connection-flood' | 'message-flood' | 'malformed-payload';
  params?: Record<string, unknown>;
}

/**
 * Dispara um ataque: o api cria a run, manda o ataque ao container `attacker`,
 * registra o KPI e encerra a run, tudo em background (ADR-0012). Responde 202 assim
 * que a run existe; o andamento chega pelo polling de `useActiveRun`.
 */
export function useLaunchRun() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: LaunchRunInput) => {
      const response = await api.post<ExperimentRun>('/experiments/runs/launch', input);
      return response.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ACTIVE_RUN_KEY }),
  });
}

/** Mensagem legível para um erro do `/launch` (409 run ativa, 400 params, rede). */
export function describeLaunchError(error: unknown): string {
  const response = (error as { response?: { status?: number; data?: { message?: unknown } } })
    ?.response;
  if (response?.status === 409) {
    return 'Já existe uma run ativa. Aguarde ela terminar (ou pare-a acima) antes de disparar outra.';
  }
  const message = response?.data?.message;
  if (Array.isArray(message) && message.length > 0) return message.join('; ');
  if (typeof message === 'string' && message) return message;
  return 'Não foi possível disparar o ataque. Verifique se o backend está no ar.';
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
