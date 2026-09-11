import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ExperimentsModule } from '../experiments/experiments.module';
import { MetricsModule } from '../metrics/metrics.module';
import { AttacksController } from './attacks.controller';
import { AttacksService } from './attacks.service';

@Module({
  imports: [AuthModule, ExperimentsModule, MetricsModule],
  controllers: [AttacksController],
  providers: [AttacksService],
})
export class AttacksModule {}
