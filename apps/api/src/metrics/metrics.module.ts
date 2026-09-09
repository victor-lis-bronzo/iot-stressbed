import { Module, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ExperimentsModule } from '../experiments/experiments.module';
import { InfluxdbTelemetryQueryAdapter } from './adapters/influxdb-telemetry-query.adapter';
import { RunKpi } from './entities/run-kpi.entity';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { TELEMETRY_QUERY } from './metrics.tokens';

const telemetryQueryProvider: Provider = {
  provide: TELEMETRY_QUERY,
  inject: [ConfigService],
  useFactory: (config: ConfigService) =>
    new InfluxdbTelemetryQueryAdapter({
      url: config.get<string>(
        'INFLUXDB_URL',
        `http://localhost:${config.get('INFLUXDB_PORT', 8086)}`,
      ),
      token: config.get<string>('INFLUXDB_TOKEN', ''),
      org: config.get<string>('INFLUXDB_ORG', 'stressbed'),
      bucket: config.get<string>('INFLUXDB_BUCKET', 'stressbed'),
    }),
};

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([RunKpi]),
    ExperimentsModule,
    AuthModule,
  ],
  controllers: [MetricsController],
  providers: [MetricsService, telemetryQueryProvider],
  exports: [MetricsService],
})
export class MetricsModule {}
