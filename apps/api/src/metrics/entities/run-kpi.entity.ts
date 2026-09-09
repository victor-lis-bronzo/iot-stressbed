import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ExperimentRun } from '../../experiments/entities/experiment-run.entity';

export type InjectionConnectStatus = 'connected' | 'rejected';
export type PayloadReadabilityClassification =
  | 'legivel'
  | 'ciphertext'
  | 'inconclusivo';

@Entity('run_kpis')
export class RunKpi {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty()
  @Column({ name: 'run_id', type: 'uuid', unique: true })
  runId: string;

  @OneToOne(() => ExperimentRun, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run?: ExperimentRun;

  @ApiPropertyOptional({ nullable: true })
  @Column({
    name: 'interception_coverage_pct',
    type: 'float',
    nullable: true,
    default: null,
  })
  interceptionCoveragePct: number | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ name: 'entropy_bits', type: 'float', nullable: true, default: null })
  entropyBits: number | null;

  @ApiPropertyOptional({
    nullable: true,
    enum: ['legivel', 'ciphertext', 'inconclusivo'],
  })
  @Column({
    name: 'payload_readability_classification',
    type: 'varchar',
    nullable: true,
    default: null,
  })
  payloadReadabilityClassification: PayloadReadabilityClassification | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({
    name: 'injection_success_rate_pct',
    type: 'float',
    nullable: true,
    default: null,
  })
  injectionSuccessRatePct: number | null;

  @ApiPropertyOptional({ nullable: true, enum: ['connected', 'rejected'] })
  @Column({
    name: 'injection_connect_status',
    type: 'varchar',
    nullable: true,
    default: null,
  })
  injectionConnectStatus: InjectionConnectStatus | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({
    name: 'time_to_first_capture_ms',
    type: 'integer',
    nullable: true,
    default: null,
  })
  timeToFirstCaptureMs: number | null;

  @ApiProperty()
  @CreateDateColumn({ name: 'calculated_at' })
  calculatedAt: Date;
}
