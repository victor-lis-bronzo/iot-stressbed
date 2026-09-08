import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { AuthService } from './auth.service';
import { User } from './entities/user.entity';

describe('AuthService', () => {
  const secret = 'test-secret';
  let jwtService: JwtService;
  let users: Partial<Record<keyof Repository<User>, jest.Mock>>;
  let service: AuthService;

  beforeEach(() => {
    jwtService = new JwtService({ secret, signOptions: { expiresIn: '1h' } });
    users = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    const config = { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService;
    service = new AuthService(
      users as unknown as Repository<User>,
      jwtService,
      config,
    );
  });

  it('issues a verifiable JWT for valid credentials', async () => {
    const passwordHash = await bcrypt.hash('s3cret', 10);
    users.findOne!.mockResolvedValue({
      id: 'user-1',
      email: 'a@b.com',
      passwordHash,
    });

    const { access_token } = await service.login({
      email: 'a@b.com',
      password: 's3cret',
    });

    const payload = await jwtService.verifyAsync(access_token, { secret });
    expect(payload.sub).toBe('user-1');
    expect(payload.email).toBe('a@b.com');
  });

  it('rejects an unknown user', async () => {
    users.findOne!.mockResolvedValue(null);
    await expect(
      service.login({ email: 'x@y.com', password: 'nope' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a wrong password', async () => {
    const passwordHash = await bcrypt.hash('right', 10);
    users.findOne!.mockResolvedValue({
      id: 'user-1',
      email: 'a@b.com',
      passwordHash,
    });
    await expect(
      service.login({ email: 'a@b.com', password: 'wrong' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
