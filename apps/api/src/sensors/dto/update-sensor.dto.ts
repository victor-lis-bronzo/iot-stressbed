import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateSensorDto {
  @ApiPropertyOptional({ example: 'esp32-01' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @ApiPropertyOptional({ example: 'Laboratório A' })
  @IsOptional()
  @IsString()
  location?: string;
}
