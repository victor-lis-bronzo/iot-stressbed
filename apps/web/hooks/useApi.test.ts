import { renderHook } from '@testing-library/react';
import { signOut, useSession } from 'next-auth/react';
import { useApi } from './useApi';

jest.mock('next-auth/react', () => ({
  useSession: jest.fn(),
  signOut: jest.fn(),
}));

describe('useApi', () => {
  beforeEach(() => {
    (signOut as jest.Mock).mockReset();
  });

  it('sends the session access token as a bearer token', () => {
    (useSession as jest.Mock).mockReturnValue({ data: { accessToken: 'fake-token' } });

    const { result } = renderHook(() => useApi());

    expect(result.current.defaults.headers.Authorization).toBe('Bearer fake-token');
  });

  it('omits the header when there is no session yet', () => {
    (useSession as jest.Mock).mockReturnValue({ data: null });

    const { result } = renderHook(() => useApi());

    expect(result.current.defaults.headers.Authorization).toBeUndefined();
  });

  it('signs out when the backend rejects the token', async () => {
    (useSession as jest.Mock).mockReturnValue({ data: { accessToken: 'stale-token' } });

    const { result } = renderHook(() => useApi());
    result.current.defaults.adapter = () =>
      Promise.reject({ response: { status: 401 } });

    await expect(result.current.get('/sensors')).rejects.toBeDefined();
    expect(signOut).toHaveBeenCalledWith({ redirectTo: '/login' });
  });

  it('leaves other failures to the caller', async () => {
    (useSession as jest.Mock).mockReturnValue({ data: { accessToken: 'fake-token' } });

    const { result } = renderHook(() => useApi());
    result.current.defaults.adapter = () =>
      Promise.reject({ response: { status: 500 } });

    await expect(result.current.get('/sensors')).rejects.toBeDefined();
    expect(signOut).not.toHaveBeenCalled();
  });
});
