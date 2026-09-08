import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateSensorDto } from './dto/create-sensor.dto';
import { UpdateSensorDto } from './dto/update-sensor.dto';
import { Sensor } from './entities/sensor.entity';
import { SensorsService } from './sensors.service';

@ApiTags('sensors')
@ApiBearerAuth()
@ApiResponse({ status: 401, description: 'Token ausente ou inválido' })
@Controller('sensors')
@UseGuards(JwtAuthGuard)
export class SensorsController {
  constructor(private readonly sensorsService: SensorsService) {}

  @Post()
  @ApiOperation({ summary: 'Cadastra um sensor' })
  @ApiResponse({ status: 201, description: 'Sensor criado', type: Sensor })
  create(@Body() dto: CreateSensorDto) {
    return this.sensorsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lista todos os sensores' })
  @ApiResponse({ status: 200, description: 'Lista de sensores', type: [Sensor] })
  findAll() {
    return this.sensorsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Busca um sensor pelo id' })
  @ApiResponse({ status: 200, description: 'Sensor encontrado', type: Sensor })
  @ApiResponse({ status: 404, description: 'Sensor não encontrado' })
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.sensorsService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza um sensor' })
  @ApiResponse({ status: 200, description: 'Sensor atualizado', type: Sensor })
  @ApiResponse({ status: 404, description: 'Sensor não encontrado' })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateSensorDto,
  ) {
    return this.sensorsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove um sensor' })
  @ApiResponse({ status: 204, description: 'Sensor removido' })
  @ApiResponse({ status: 404, description: 'Sensor não encontrado' })
  remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.sensorsService.remove(id);
  }
}
