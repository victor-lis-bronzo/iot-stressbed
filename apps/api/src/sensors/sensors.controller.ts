import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateSensorDto } from './dto/create-sensor.dto';
import { UpdateSensorDto } from './dto/update-sensor.dto';
import { SensorsService } from './sensors.service';

@Controller('sensors')
@UseGuards(JwtAuthGuard)
export class SensorsController {
  constructor(private readonly sensorsService: SensorsService) {}

  @Post()
  create(@Body() dto: CreateSensorDto) {
    return this.sensorsService.create(dto);
  }

  @Get()
  findAll() {
    return this.sensorsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.sensorsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSensorDto) {
    return this.sensorsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.sensorsService.remove(id);
  }
}
