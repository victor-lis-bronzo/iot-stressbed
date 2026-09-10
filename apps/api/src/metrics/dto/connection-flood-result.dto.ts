import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

/**
 * Espelha o JSON impresso em stdout por attacker/python/connection_flood.py
 * (dataclasses.asdict(ConnectionFloodResult)) — os nomes de campo são
 * snake_case de propósito, para o script poder repassar o stdout sem
 * transformação (mesmo padrão de InjectionResultDto).
 */
export class ConnectionFloodResultDto {
  @ApiProperty({ enum: ['plain', 'secure'] })
  @IsIn(['plain', 'secure'])
  target: 'plain' | 'secure';

  @ApiProperty()
  @IsString()
  host: string;

  @ApiProperty()
  @IsInt()
  port: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  connections_attempted: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  connections_established: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  connections_rejected: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber()
  success_rate?: number | null;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  errors: string[];

  @ApiProperty()
  @IsISO8601()
  started_at: string;

  @ApiProperty()
  @IsISO8601()
  finished_at: string;
}
