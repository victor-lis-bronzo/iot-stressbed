import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type RunMode = 'plain' | 'secure';

@Entity('experiment_runs')
@Index('experiment_runs_single_active_run', ['endedAt'], {
  unique: true,
  where: '"ended_at" IS NULL',
})
export class ExperimentRun {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ enum: ['plain', 'secure'] })
  @Column({ type: 'varchar' })
  mode: RunMode;

  @ApiProperty()
  @Column({ name: 'attack_type', type: 'varchar' })
  attackType: string;

  @ApiPropertyOptional({ type: Object, additionalProperties: true, nullable: true })
  @Column({ type: 'jsonb', nullable: true })
  params: Record<string, unknown> | null;

  @ApiProperty()
  @CreateDateColumn({ name: 'started_at' })
  startedAt: Date;

  @ApiPropertyOptional({ nullable: true })
  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt: Date | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'text', nullable: true })
  notes: string | null;
}
