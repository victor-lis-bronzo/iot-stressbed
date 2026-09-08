import { Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { LoginDto } from './dto/login.dto';
import { User } from './entities/user.entity';

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    await this.seedDefaultAdmin();
  }

  async login(dto: LoginDto): Promise<{ access_token: string }> {
    const user = await this.users.findOne({ where: { email: dto.email } });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const token = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
    });
    return { access_token: token };
  }

  private async seedDefaultAdmin() {
    const email = this.config.get<string>('AUTH_ADMIN_EMAIL');
    const password = this.config.get<string>('AUTH_ADMIN_PASSWORD');
    if (!email || !password) {
      return;
    }
    const existing = await this.users.findOne({ where: { email } });
    if (existing) {
      return;
    }
    const passwordHash = await bcrypt.hash(password, 10);
    await this.users.save(this.users.create({ email, passwordHash }));
  }
}
