import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import { RunMode } from '../../experiments/entities/experiment-run.entity';

export type AttackTrack =
  | 'injection'
  | 'connection-flood'
  | 'message-flood'
  | 'malformed-payload';

const ATTACK_TRACKS: AttackTrack[] = [
  'injection',
  'connection-flood',
  'message-flood',
  'malformed-payload',
];

export class StartAttackDto {
  @ApiProperty({ enum: ATTACK_TRACKS })
  @IsIn(ATTACK_TRACKS)
  track: AttackTrack;

  @ApiProperty({ enum: ['plain', 'secure'] })
  @IsIn(['plain', 'secure'])
  mode: RunMode;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  args?: string[];
}
