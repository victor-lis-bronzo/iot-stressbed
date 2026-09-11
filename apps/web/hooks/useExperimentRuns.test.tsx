import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useApi } from './useApi';
import { useActiveRun, useStartAttack, useStopRun } from './useExperimentRuns';

jest.mock('./useApi', () => ({
  useApi: jest.fn(),
}));

const api = {
  get: jest.fn(),
  post: jest.fn(),
};

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useExperimentRuns', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useApi as jest.Mock).mockReturnValue(api);
  });

  it('returns null when there is no active run', async () => {
    api.get.mockResolvedValue({ data: null });

    const { result } = renderHook(() => useActiveRun(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    expect(api.get).toHaveBeenCalledWith('/experiments/runs/active');
  });

  it('returns the active run when the backend reports one', async () => {
    const run = {
      id: 'run-1',
      mode: 'plain',
      attackType: 'connection-flood',
      params: null,
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: null,
      notes: null,
    };
    api.get.mockResolvedValue({ data: run });

    const { result } = renderHook(() => useActiveRun(), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(run));
  });

  it('stops the active run (via the attacks endpoint, so a managed process is also killed) and invalidates it', async () => {
    api.post.mockResolvedValue({ data: null });

    const { result } = renderHook(() => useStopRun(), { wrapper });
    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.post).toHaveBeenCalledWith('/experiments/attacks/stop');
  });

  it('starts an attack and invalidates the active run', async () => {
    const run = {
      id: 'run-1',
      mode: 'plain' as const,
      attackType: 'connection-flood',
      params: null,
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: null,
      notes: null,
    };
    api.post.mockResolvedValue({ data: run });

    const { result } = renderHook(() => useStartAttack(), { wrapper });
    result.current.mutate({ track: 'connection-flood', mode: 'plain', args: ['--connections', '250'] });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.post).toHaveBeenCalledWith('/experiments/attacks/start', {
      track: 'connection-flood',
      mode: 'plain',
      args: ['--connections', '250'],
    });
    expect(result.current.data).toEqual(run);
  });
});
