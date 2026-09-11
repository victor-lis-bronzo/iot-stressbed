import { Controller, HttpCode, Post, UseGuards, Body } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ExperimentRun } from '../experiments/entities/experiment-run.entity';
import { AttacksService } from './attacks.service';
import { StartAttackDto } from './dto/start-attack.dto';

@ApiTags('attacks')
@ApiBearerAuth()
@ApiResponse({ status: 401, description: 'Token ausente ou inválido' })
@Controller('experiments/attacks')
@UseGuards(JwtAuthGuard)
export class AttacksController {
  constructor(private readonly attacksService: AttacksService) {}

  @Post('start')
  @ApiOperation({
    summary:
      'Inicia uma run e dispara o script correspondente no container attacker',
  })
  @ApiResponse({ status: 201, description: 'Ataque iniciado', type: ExperimentRun })
  @ApiResponse({ status: 409, description: 'Já existe uma run/ataque ativo' })
  start(@Body() dto: StartAttackDto) {
    return this.attacksService.start(dto);
  }

  @Post('stop')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Interrompe o ataque gerenciado em execução e encerra a run',
  })
  @ApiResponse({
    status: 200,
    description: 'Run encerrada (ou null se não havia run ativa)',
    type: ExperimentRun,
  })
  stop() {
    return this.attacksService.stop();
  }
}
