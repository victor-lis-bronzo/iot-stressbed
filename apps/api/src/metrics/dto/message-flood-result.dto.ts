import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

/**
 * Espelha o JSON impresso em stdout por attacker/python/message_flood.py
 * (dataclasses.asdict(MessageFloodResult)) — os nomes de campo são snake_case
 * de propósito, para o script poder repassar o stdout sem transformação
 * (mesmo padrão de InjectionResultDto).
 */
export class MessageFloodResultDto {
  @ApiProperty({ enum: ['plain', 'secure'] })
  @IsIn(['plain', 'secure'])
  target: 'plain' | 'secure';

  @ApiProperty()
  @IsString()
  topic: string;

  @ApiProperty()
  @IsString()
  host: string;

  @ApiProperty()
  @IsInt()
  port: number;

  @ApiProperty({ enum: ['connected', 'rejected'] })
  @IsIn(['connected', 'rejected'])
  connect_status: 'connected' | 'rejected';

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  connect_error?: string | null;

  @ApiProperty()
  @IsInt()
  @Min(0)
  attempted: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  accepted: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber()
  success_rate?: number | null;

  @ApiProperty()
  @IsNumber()
  elapsed_seconds: number;

  @ApiProperty()
  @IsNumber()
  achieved_rate: number;

  @ApiProperty()
  @IsISO8601()
  started_at: string;

  @ApiProperty()
  @IsISO8601()
  finished_at: string;
}
