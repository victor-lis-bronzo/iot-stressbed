import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

/**
 * Espelha o JSON impresso em stdout por attacker/python/malformed_payload.py
 * (dataclasses.asdict(MalformedPayloadResult)) — os nomes de campo são
 * snake_case de propósito, para o script poder repassar o stdout sem
 * transformação (mesmo padrão de InjectionResultDto).
 *
 * Atenção: o campo `mode` abaixo é o tipo de payload adversarial enviado
 * ('giant' | 'invalid-utf8' | 'invalid-json' | 'null-bytes'), NÃO o `mode`
 * de ExperimentRun ('plain' | 'secure') usado em outros lugares da API.
 */
export class MalformedPayloadResultDto {
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

  @ApiProperty({ enum: ['giant', 'invalid-utf8', 'invalid-json', 'null-bytes'] })
  @IsIn(['giant', 'invalid-utf8', 'invalid-json', 'null-bytes'])
  mode: 'giant' | 'invalid-utf8' | 'invalid-json' | 'null-bytes';

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
  publish_accepted: number;

  @ApiProperty()
  @IsBoolean()
  disconnected_after_publish: boolean;

  @ApiProperty()
  @IsString()
  broker_response_summary: string;

  @ApiProperty()
  @IsISO8601()
  started_at: string;

  @ApiProperty()
  @IsISO8601()
  finished_at: string;
}
