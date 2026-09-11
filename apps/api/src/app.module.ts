import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AttacksModule } from './attacks/attacks.module';
import { AuthModule } from './auth/auth.module';
import { CaptureModule } from './capture/capture.module';
import { ExperimentsModule } from './experiments/experiments.module';
import { MetricsModule } from './metrics/metrics.module';
import { RealtimeModule } from './realtime/realtime.module';
import { SensorsModule } from './sensors/sensors.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    EventEmitterModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('POSTGRES_HOST', 'localhost'),
        port: Number(config.get('POSTGRES_PORT', 5432)),
        username: config.get('POSTGRES_USER', 'stressbed'),
        password: config.get('POSTGRES_PASSWORD', 'stressbed'),
        database: config.get('POSTGRES_DB', 'stressbed'),
        autoLoadEntities: true,
        synchronize: true,
      }),
    }),
    AuthModule,
    SensorsModule,
    ExperimentsModule,
    CaptureModule,
    MetricsModule,
    RealtimeModule,
    AttacksModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
