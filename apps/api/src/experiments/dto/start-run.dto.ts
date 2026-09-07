import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { RunMode } from '../entities/experiment-run.entity';

export class StartRunDto {
  @IsIn(['plain', 'secure'])
  mode: RunMode;

  @IsString()
  @MinLength(1)
  attackType: string;

  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  notes?: string;
}
