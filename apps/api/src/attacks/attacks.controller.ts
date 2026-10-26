import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ExperimentRun } from '../experiments/entities/experiment-run.entity';
import { AttackOrchestratorService } from './attack-orchestrator.service';
import { LaunchRunDto } from './dto/launch-run.dto';

@ApiTags('experiments')
@ApiBearerAuth()
@ApiResponse({ status: 401, description: 'Token ausente ou inválido' })
@Controller('experiments/runs')
@UseGuards(JwtAuthGuard)
export class AttacksController {
  constructor(private readonly orchestrator: AttackOrchestratorService) {}

  @Post('launch')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Inicia uma run e dispara o ataque no attacker (em background)',
    description:
      'Equivale ao antigo run-experiment.sh: start da run, ataque, registro do KPI e stop. ' +
      'Responde assim que a run é criada; acompanhe por GET /experiments/runs/active e ' +
      'GET /metrics/runs/:runId.',
  })
  @ApiResponse({ status: 202, description: 'Run criada; ataque em andamento', type: ExperimentRun })
  @ApiResponse({ status: 400, description: 'Parâmetros inválidos' })
  @ApiResponse({ status: 409, description: 'Já existe uma run ativa' })
  launch(@Body() dto: LaunchRunDto) {
    return this.orchestrator.launch(dto);
  }
}
