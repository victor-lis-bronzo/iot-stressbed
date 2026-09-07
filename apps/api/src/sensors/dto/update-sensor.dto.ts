import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateSensorDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  location?: string;
}
