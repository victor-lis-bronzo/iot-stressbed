import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useApi } from './useApi';
import { useDosRunHistory, useDosRunResult, type RunKpi } from './useDosMetrics';

jest.mock('./useApi', () => ({
  useApi: jest.fn(),
}));

const api = {
  get: jest.fn(),
};

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function makeKpi(overrides: Partial<RunKpi>): RunKpi {
  return {
    id: 'kpi-1',
    runId: 'run-1',
    interceptionCoveragePct: null,
    entropyBits: null,
    payloadReadabilityClassification: null,
    injectionSuccessRatePct: null,
    injectionConnectStatus: null,
    timeToFirstCaptureMs: null,
    trackBAttackType: null,
    trackBResult: null,
    attackStartedAt: null,
    attackFinishedAt: null,
    calculatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('useDosMetrics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useApi as jest.Mock).mockReturnValue(api);
  });

  it('does not fetch when runId is undefined', () => {
    const { result } = renderHook(() => useDosRunResult(undefined), { wrapper });

    expect(result.current.fetchStatus).toBe('idle');
    expect(api.get).not.toHaveBeenCalled();
  });

  it('fetches the KPI for a given run id', async () => {
    const kpi = makeKpi({ runId: 'run-2', trackBAttackType: 'connection-flood' });
    api.get.mockResolvedValue({ data: kpi });

    const { result } = renderHook(() => useDosRunResult('run-2'), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(kpi));
    expect(api.get).toHaveBeenCalledWith('/metrics/runs/run-2');
  });

  it('handles a run with no KPI calculated yet without throwing', async () => {
    api.get.mockResolvedValue({ data: null });

    const { result } = renderHook(() => useDosRunResult('run-3'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('filters out Track A (injection) runs from the history', async () => {
    const runs = [
      makeKpi({ runId: 'run-a', trackBAttackType: 'message-flood' }),
      makeKpi({ runId: 'run-b', trackBAttackType: null }), // injection, sem campos de Track B
    ];
    api.get.mockResolvedValue({ data: runs });

    const { result } = renderHook(() => useDosRunHistory(), { wrapper });

    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data?.[0].runId).toBe('run-a');
  });
});
