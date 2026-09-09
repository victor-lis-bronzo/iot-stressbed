import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
import { InjectionResultDto } from './dto/injection-result.dto';
import { PayloadReadabilityDto } from './dto/payload-readability.dto';
import { RunKpi } from './entities/run-kpi.entity';
import { MetricsService } from './metrics.service';

@ApiTags('metrics')
@ApiBearerAuth()
@ApiResponse({ status: 401, description: 'Token ausente ou inválido' })
@Controller('metrics/runs')
@UseGuards(JwtAuthGuard)
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Post(':runId/injection-result')
  @ApiOperation({
    summary: 'Registra o resultado do injector.py (Track A) para uma run',
  })
  @ApiResponse({ status: 201, type: RunKpi })
  recordInjectionResult(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Body() dto: InjectionResultDto,
  ) {
    return this.metrics.recordInjectionResult(runId, dto);
  }

  @Post(':runId/payload-readability')
  @ApiOperation({
    summary:
      'Registra a classificação de entropia do pcap (legibilidade do payload) para uma run',
  })
  @ApiResponse({ status: 201, type: RunKpi })
  recordPayloadReadability(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Body() dto: PayloadReadabilityDto,
  ) {
    return this.metrics.recordPayloadReadability(runId, dto);
  }

  @Get(':runId')
  @ApiOperation({ summary: 'Retorna os KPIs do Track A para uma run' })
  @ApiResponse({ status: 200, type: RunKpi })
  getForRun(@Param('runId', ParseUUIDPipe) runId: string) {
    return this.metrics.getForRun(runId);
  }

  @Get()
  @ApiOperation({ summary: 'Lista os KPIs do Track A de todas as runs' })
  @ApiResponse({ status: 200, type: [RunKpi] })
  listAll() {
    return this.metrics.listAll();
  }
}
