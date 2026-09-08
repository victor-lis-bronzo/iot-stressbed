import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Sensor } from './entities/sensor.entity';
import { SensorsController } from './sensors.controller';
import { SensorsService } from './sensors.service';

@Module({
  imports: [TypeOrmModule.forFeature([Sensor]), AuthModule],
  controllers: [SensorsController],
  providers: [SensorsService],
})
export class SensorsModule {}
