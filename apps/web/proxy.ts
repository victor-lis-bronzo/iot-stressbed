import { NextResponse } from 'next/server';
import { auth } from '@/auth';

// Next 16 depreciou `middleware.ts` em favor deste nome; a funcionalidade e a mesma.
export default auth((request) => {
  if (request.auth) {
    return NextResponse.next();
  }

  const loginUrl = new URL('/login', request.nextUrl);
  loginUrl.searchParams.set('callbackUrl', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
});

export const config = {
  matcher: ['/((?!login|api|_next/static|_next/image|favicon.ico).*)'],
};
