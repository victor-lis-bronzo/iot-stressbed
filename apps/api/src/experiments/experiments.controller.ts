import {
  Body,
  Controller,
  Get,
  HttpCode,
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
import { StartRunDto } from './dto/start-run.dto';
import { ExperimentRun } from './entities/experiment-run.entity';
import { ExperimentsService } from './experiments.service';

@ApiTags('experiments')
@ApiBearerAuth()
@ApiResponse({ status: 401, description: 'Token ausente ou inválido' })
@Controller('experiments/runs')
@UseGuards(JwtAuthGuard)
export class ExperimentsController {
  constructor(private readonly experimentsService: ExperimentsService) {}

  @Post('start')
  @ApiOperation({ summary: 'Inicia uma nova run de experimento' })
  @ApiResponse({ status: 201, description: 'Run iniciada', type: ExperimentRun })
  @ApiResponse({ status: 409, description: 'Já existe uma run ativa' })
  start(@Body() dto: StartRunDto) {
    return this.experimentsService.start(dto);
  }

  @Post('stop')
  @HttpCode(200)
  @ApiOperation({ summary: 'Encerra a run ativa, se houver' })
  @ApiResponse({
    status: 200,
    description: 'Run encerrada (ou null se não havia run ativa)',
    type: ExperimentRun,
  })
  stop() {
    return this.experimentsService.stop();
  }

  @Get('active')
  @ApiOperation({ summary: 'Retorna a run ativa, se houver' })
  @ApiResponse({
    status: 200,
    description: 'Run ativa (ou null se não houver)',
    type: ExperimentRun,
  })
  active() {
    return this.experimentsService.getActiveRun();
  }
}
