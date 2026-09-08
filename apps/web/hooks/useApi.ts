'use client';

import { useMemo } from 'react';
import { signOut, useSession } from 'next-auth/react';
import { createApiClient } from '@/lib/api';

export function useApi() {
  const { data: session } = useSession();
  const accessToken = session?.accessToken;

  return useMemo(() => {
    const client = createApiClient(accessToken);

    // O backend nao tem refresh token: um 401 significa sessao morta, nao recuperavel.
    client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          signOut({ redirectTo: '/login' });
        }
        return Promise.reject(error);
      }
    );

    return client;
  }, [accessToken]);
}
