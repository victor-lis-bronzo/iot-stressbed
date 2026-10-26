import { Module, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { ExperimentsModule } from '../experiments/experiments.module';
import { MetricsModule } from '../metrics/metrics.module';
import { HttpAttackRunnerAdapter } from './adapters/http-attack-runner.adapter';
import { AttackOrchestratorService } from './attack-orchestrator.service';
import { AttacksController } from './attacks.controller';
import { ATTACK_RUNNER } from './attacks.tokens';

const attackRunnerProvider: Provider = {
  provide: ATTACK_RUNNER,
  inject: [ConfigService],
  useFactory: (config: ConfigService) =>
    new HttpAttackRunnerAdapter({
      baseUrl: config.get<string>('ATTACKER_RUNNER_URL', 'http://attacker:8080'),
      // Um pouco acima do teto do runner (3600 s): quem expira primeiro é o runner.
      timeoutMs: Number(config.get('ATTACKER_RUNNER_TIMEOUT_MS', 3_700_000)),
    }),
};

@Module({
  imports: [ConfigModule, ExperimentsModule, MetricsModule, AuthModule],
  controllers: [AttacksController],
  providers: [AttackOrchestratorService, attackRunnerProvider],
})
export class AttacksModule {}
