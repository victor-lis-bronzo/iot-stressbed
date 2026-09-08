import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateSensorDto {
  @ApiProperty({ example: 'esp32-01' })
  @IsString()
  @MinLength(1)
  name: string;

  @ApiPropertyOptional({ example: 'Laboratório A' })
  @IsOptional()
  @IsString()
  location?: string;
}
