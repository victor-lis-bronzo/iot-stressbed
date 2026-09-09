import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { IsNull, Repository } from 'typeorm';
import { StartRunDto } from './dto/start-run.dto';
import { ExperimentRun } from './entities/experiment-run.entity';
import { RUN_STOPPED } from './experiments.tokens';

export interface CaptureContext {
  runId: string | null;
  source: 'legit' | 'injected';
}

@Injectable()
export class ExperimentsService {
  constructor(
    @InjectRepository(ExperimentRun)
    private readonly runs: Repository<ExperimentRun>,
    private readonly events: EventEmitter2,
  ) {}

  async start(dto: StartRunDto): Promise<ExperimentRun> {
    const active = await this.getActiveRun();
    if (active) {
      throw new ConflictException(
        `A run is already active (id=${active.id}); stop it before starting another`,
      );
    }
    try {
      return await this.runs.save(
        this.runs.create({
          mode: dto.mode,
          attackType: dto.attackType,
          params: dto.params ?? null,
          notes: dto.notes ?? null,
          endedAt: null,
        }),
      );
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(
          'A run is already active; stop it before starting another',
        );
      }
      throw error;
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    const code =
      (error as { code?: string; driverError?: { code?: string } })?.code ??
      (error as { driverError?: { code?: string } })?.driverError?.code;
    return code === '23505';
  }

  async stop(): Promise<ExperimentRun | null> {
    const active = await this.getActiveRun();
    if (!active) {
      return null;
    }
    active.endedAt = new Date();
    const stopped = await this.runs.save(active);
    this.events.emit(RUN_STOPPED, stopped.id);
    return stopped;
  }

  getActiveRun(): Promise<ExperimentRun | null> {
    return this.runs.findOne({
      where: { endedAt: IsNull() },
      order: { startedAt: 'DESC' },
    });
  }

  findById(id: string): Promise<ExperimentRun | null> {
    return this.runs.findOne({ where: { id } });
  }

  async resolveCaptureContext(): Promise<CaptureContext> {
    const active = await this.getActiveRun();
    if (!active) {
      return { runId: null, source: 'legit' };
    }
    return {
      runId: active.id,
      source: active.attackType === 'injection' ? 'injected' : 'legit',
    };
  }
}
