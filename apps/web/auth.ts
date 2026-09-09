import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { INTERNAL_API_BASE_URL } from '@/lib/api';

// Espelha JWT_EXPIRES_IN do backend. O backend nao tem refresh nem revogacao,
// entao uma sessao mais longa que o token viraria 401 silencioso a cada chamada.
const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: 'jwt', maxAge: SESSION_MAX_AGE_SECONDS },
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Senha', type: 'password' },
      },
      async authorize(credentials) {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== 'string' || typeof password !== 'string') {
          return null;
        }

        const response = await fetch(`${INTERNAL_API_BASE_URL}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });

        if (!response.ok) {
          return null;
        }

        const { access_token: accessToken } = await response.json();
        if (!accessToken) {
          return null;
        }

        return { id: email, email, accessToken };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.accessToken = user.accessToken;
      }
      return token;
    },
    session({ session, token }) {
      session.accessToken = token.accessToken;
      return session;
    },
  },
});
