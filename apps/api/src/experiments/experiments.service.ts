import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { StartRunDto } from './dto/start-run.dto';
import { ExperimentRun } from './entities/experiment-run.entity';

export interface CaptureContext {
  runId: string | null;
  source: 'legit' | 'injected';
}

@Injectable()
export class ExperimentsService {
  constructor(
    @InjectRepository(ExperimentRun)
    private readonly runs: Repository<ExperimentRun>,
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
    return this.runs.save(active);
  }

  getActiveRun(): Promise<ExperimentRun | null> {
    return this.runs.findOne({
      where: { endedAt: IsNull() },
      order: { startedAt: 'DESC' },
    });
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
