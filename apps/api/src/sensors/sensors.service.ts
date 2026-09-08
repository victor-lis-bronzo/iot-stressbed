import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateSensorDto } from './dto/create-sensor.dto';
import { UpdateSensorDto } from './dto/update-sensor.dto';
import { Sensor } from './entities/sensor.entity';

@Injectable()
export class SensorsService {
  constructor(
    @InjectRepository(Sensor)
    private readonly sensors: Repository<Sensor>,
  ) {}

  create(dto: CreateSensorDto): Promise<Sensor> {
    return this.sensors.save(this.sensors.create(dto));
  }

  findAll(): Promise<Sensor[]> {
    return this.sensors.find({ order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<Sensor> {
    const sensor = await this.sensors.findOne({ where: { id } });
    if (!sensor) {
      throw new NotFoundException(`Sensor ${id} not found`);
    }
    return sensor;
  }

  async update(id: string, dto: UpdateSensorDto): Promise<Sensor> {
    const sensor = await this.findOne(id);
    Object.assign(sensor, dto);
    return this.sensors.save(sensor);
  }

  async remove(id: string): Promise<void> {
    const result = await this.sensors.delete(id);
    if (!result.affected) {
      throw new NotFoundException(`Sensor ${id} not found`);
    }
  }
}
