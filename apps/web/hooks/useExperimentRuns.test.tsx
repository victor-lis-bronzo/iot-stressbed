import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useApi } from './useApi';
import {
  describeLaunchError,
  useActiveRun,
  useLaunchRun,
  useStopRun,
} from './useExperimentRuns';

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

  it('stops the active run and invalidates it', async () => {
    api.post.mockResolvedValue({ data: null });

    const { result } = renderHook(() => useStopRun(), { wrapper });
    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.post).toHaveBeenCalledWith('/experiments/runs/stop');
  });

  it('launches an attack through /experiments/runs/launch and returns the created run', async () => {
    const run = { id: 'run-1', mode: 'plain', attackType: 'connection-flood' };
    api.post.mockResolvedValue({ data: run });

    const { result } = renderHook(() => useLaunchRun(), { wrapper });
    result.current.mutate({
      mode: 'plain',
      attackType: 'connection-flood',
      params: { connections: 200 },
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.post).toHaveBeenCalledWith('/experiments/runs/launch', {
      mode: 'plain',
      attackType: 'connection-flood',
      params: { connections: 200 },
    });
    expect(result.current.data).toEqual(run);
  });

  it('surfaces a failed launch as an error', async () => {
    api.post.mockRejectedValue({ response: { status: 409 } });

    const { result } = renderHook(() => useLaunchRun(), { wrapper });
    result.current.mutate({ mode: 'plain', attackType: 'injection' });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('describeLaunchError', () => {
  it('explains a 409 as an already active run', () => {
    expect(describeLaunchError({ response: { status: 409 } })).toMatch(/já existe uma run ativa/i);
  });

  it('uses the backend message for validation errors, joining arrays', () => {
    expect(
      describeLaunchError({ response: { status: 400, data: { message: 'parâmetro inválido: X' } } }),
    ).toBe('parâmetro inválido: X');
    expect(
      describeLaunchError({ response: { status: 400, data: { message: ['a', 'b'] } } }),
    ).toBe('a; b');
  });

  it('falls back to a generic message for network errors and unknown shapes', () => {
    expect(describeLaunchError(new Error('Network Error'))).toMatch(/não foi possível disparar/i);
    expect(describeLaunchError(undefined)).toMatch(/não foi possível disparar/i);
    expect(describeLaunchError({ response: { status: 500, data: {} } })).toMatch(
      /não foi possível disparar/i,
    );
  });
});
