import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsNumber, IsOptional, Min } from 'class-validator';

/**
 * Espelha o JSON impresso em stdout por attacker/python/injector.py
 * (dataclasses.asdict(InjectionResult)) — os nomes de campo são snake_case
 * de propósito, para o script poder repassar o stdout sem transformação.
 */
export class InjectionResultDto {
  @ApiProperty({ enum: ['connected', 'rejected'] })
  @IsIn(['connected', 'rejected'])
  connect_status: 'connected' | 'rejected';

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
}
