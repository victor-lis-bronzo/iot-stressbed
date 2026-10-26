import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';
import { RunMode } from '../../experiments/entities/experiment-run.entity';
import { ATTACK_TYPES, AttackType } from '../ports/attack-runner.port';

export class LaunchRunDto {
  @ApiProperty({ enum: ['plain', 'secure'] })
  @IsIn(['plain', 'secure'])
  mode: RunMode;

  @ApiProperty({ enum: ATTACK_TYPES, example: 'connection-flood' })
  @IsIn(ATTACK_TYPES as unknown as string[])
  attackType: AttackType;

  @ApiPropertyOptional({
    type: Object,
    additionalProperties: true,
    example: { connections: 200 },
    description:
      'Flags do ataque como objeto {flag: valor}; gravado em experiment_runs.params.',
  })
  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
