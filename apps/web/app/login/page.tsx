'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { signIn } from 'next-auth/react';

interface LoginFields {
  email: string;
  password: string;
}

const INPUT_CLASS =
  'mt-1.5 block w-full appearance-none rounded border border-border bg-base px-3 py-2 text-sm text-primary focus:border-secured focus:ring-1 focus:ring-secured focus:outline-none';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState('');
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<LoginFields>();

  const onSubmit = async ({ email, password }: LoginFields) => {
    setError('');

    const result = await signIn('credentials', { email, password, redirect: false });

    if (!result || result.error) {
      setError('Falha ao autenticar. Verifique email e senha.');
      return;
    }

    router.push(searchParams.get('callbackUrl') || '/dashboard');
  };

  return (
    <form className="space-y-5 px-6 py-6" onSubmit={handleSubmit(onSubmit)}>
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-primary">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          className={INPUT_CLASS}
          {...register('email', { required: true })}
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-primary">
          Senha
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          className={INPUT_CLASS}
          {...register('password', { required: true })}
        />
      </div>

      {error && (
        <p role="alert" className="border-l-2 border-l-critical pl-3 text-sm text-critical">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="block w-full rounded bg-secured px-4 py-2 text-sm font-medium text-[#14181F] hover:opacity-90 focus:ring-1 focus:ring-secured focus:ring-offset-2 focus:ring-offset-panel focus:outline-none disabled:opacity-50"
      >
        {isSubmitting ? 'Entrando...' : 'Entrar'}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-base font-sans px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-sm rounded border border-border border-l-2 border-l-secured bg-panel">
        <div className="border-b border-border px-6 py-5">
          <h1 className="text-lg font-medium tracking-tight text-primary">IoT StressBed</h1>
          <p className="mt-1 text-sm text-muted">Acesse o painel de pesquisa</p>
        </div>

        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
