import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useApi } from './useApi';
import { useCreateSensor, useDeleteSensor, useSensors } from './useSensors';

jest.mock('./useApi', () => ({
  useApi: jest.fn(),
}));

const api = {
  get: jest.fn(),
  post: jest.fn(),
  delete: jest.fn(),
};

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useSensors', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useApi as jest.Mock).mockReturnValue(api);
  });

  it('unwraps the sensor list from the response body', async () => {
    const sensors = [{ id: 's1', name: 'dht11-sala', location: 'Sala', createdAt: '2026-01-01' }];
    api.get.mockResolvedValue({ data: sensors });

    const { result } = renderHook(() => useSensors(), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(sensors));
    expect(api.get).toHaveBeenCalledWith('/sensors');
  });

  it('posts the sensor with the location field the backend expects', async () => {
    api.post.mockResolvedValue({ data: { id: 's1' } });

    const { result } = renderHook(() => useCreateSensor(), { wrapper });
    result.current.mutate({ name: 'dht11-sala', location: 'Sala' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.post).toHaveBeenCalledWith('/sensors', {
      name: 'dht11-sala',
      location: 'Sala',
    });
  });

  it('deletes a sensor by id', async () => {
    api.delete.mockResolvedValue({ data: undefined });

    const { result } = renderHook(() => useDeleteSensor(), { wrapper });
    result.current.mutate('s1');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.delete).toHaveBeenCalledWith('/sensors/s1');
  });
});
