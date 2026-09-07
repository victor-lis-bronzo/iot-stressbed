import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StartRunDto } from './dto/start-run.dto';
import { ExperimentsService } from './experiments.service';

@Controller('experiments/runs')
@UseGuards(JwtAuthGuard)
export class ExperimentsController {
  constructor(private readonly experimentsService: ExperimentsService) {}

  @Post('start')
  start(@Body() dto: StartRunDto) {
    return this.experimentsService.start(dto);
  }

  @Post('stop')
  @HttpCode(200)
  stop() {
    return this.experimentsService.stop();
  }

  @Get('active')
  active() {
    return this.experimentsService.getActiveRun();
  }
}
