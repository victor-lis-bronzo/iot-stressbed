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
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  mode: RunMode;

  @Column({ name: 'attack_type', type: 'varchar' })
  attackType: string;

  @Column({ type: 'jsonb', nullable: true })
  params: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'started_at' })
  startedAt: Date;

  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;
}
