'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { setToken } from '../../lib/auth';
import api from '../../lib/api';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await api.post('/auth/login', { email, password });
      if (response.data?.access_token) {
        setToken(response.data.access_token);
        router.push('/dashboard');
      } else {
        setError('Login falhou. Resposta inválida.');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Falha ao autenticar.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-base font-sans px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-sm rounded border border-border border-l-2 border-l-secured bg-panel">
        <div className="border-b border-border px-6 py-5">
          <h1 className="text-lg font-medium tracking-tight text-primary">
            IoT StressBed
          </h1>
          <p className="mt-1 text-sm text-muted">
            Acesse o painel de pesquisa
          </p>
        </div>

        <form className="space-y-5 px-6 py-6" onSubmit={handleLogin}>
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-primary"
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="mt-1.5 block w-full appearance-none rounded border border-border bg-base px-3 py-2 text-sm text-primary focus:border-secured focus:ring-1 focus:ring-secured focus:outline-none"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-primary"
            >
              Senha
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="mt-1.5 block w-full appearance-none rounded border border-border bg-base px-3 py-2 text-sm text-primary focus:border-secured focus:ring-1 focus:ring-secured focus:outline-none"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && (
            <p
              role="alert"
              className="border-l-2 border-l-critical pl-3 text-sm text-critical"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="block w-full rounded bg-secured px-4 py-2 text-sm font-medium text-[#14181F] hover:opacity-90 focus:ring-1 focus:ring-secured focus:ring-offset-2 focus:ring-offset-panel focus:outline-none disabled:opacity-50"
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
