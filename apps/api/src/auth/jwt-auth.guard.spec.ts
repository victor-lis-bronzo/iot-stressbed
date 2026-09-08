import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';

function contextWithAuth(header?: string): ExecutionContext {
  const request = { headers: header ? { authorization: header } : {} };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  const secret = 'test-secret';
  const jwtService = new JwtService({ secret });
  const guard = new JwtAuthGuard(jwtService);

  it('accepts a valid bearer token and attaches the payload', async () => {
    const token = await jwtService.signAsync({ sub: 'user-1' }, { secret });
    const ctx = contextWithAuth(`Bearer ${token}`);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('rejects a request without a token', async () => {
    await expect(guard.canActivate(contextWithAuth())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a tampered token', async () => {
    const ctx = contextWithAuth('Bearer not.a.jwt');
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
