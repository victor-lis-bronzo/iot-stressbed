/**
 * @jest-environment node
 */
import type { NextRequest } from 'next/server';
import {
  getRedirectUrl,
  unstable_doesMiddlewareMatch,
} from 'next/experimental/testing/server';
import proxy, { config } from './proxy';

// `auth()` wraps the handler and injects `request.auth`; the test drives that
// injection directly so the redirect rule is exercised without a real session.
jest.mock('@/auth', () => ({
  auth: (handler: unknown) => handler,
}));

type Session = { user: { email: string } } | null;

function run(pathname: string, session: Session) {
  const nextUrl = new URL(`http://localhost:3002${pathname}`);
  const request = { auth: session, nextUrl } as unknown as NextRequest;
  return (proxy as unknown as (request: NextRequest) => Response)(request);
}

const SESSION: Session = { user: { email: 'admin@stressbed.com' } };

describe('proxy matcher', () => {
  it.each(['/dashboard', '/sensors', '/'])('runs on %s', (pathname) => {
    expect(
      unstable_doesMiddlewareMatch({ config, url: `http://localhost:3002${pathname}` })
    ).toBe(true);
  });

  it.each([
    '/login',
    '/api/auth/session',
    '/_next/static/chunks/main.js',
    '/_next/image',
    '/favicon.ico',
  ])('skips %s', (pathname) => {
    expect(
      unstable_doesMiddlewareMatch({ config, url: `http://localhost:3002${pathname}` })
    ).toBe(false);
  });
});

describe('proxy', () => {
  it('redirects to /login with the original path as callbackUrl', () => {
    const response = run('/sensors', null);

    expect(getRedirectUrl(response as never)).toBe(
      'http://localhost:3002/login?callbackUrl=%2Fsensors'
    );
  });

  it('lets authenticated requests through', () => {
    const response = run('/sensors', SESSION);

    expect(getRedirectUrl(response as never)).toBeNull();
  });
});
