import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNumber } from 'class-validator';

export class PayloadReadabilityDto {
  @ApiProperty()
  @IsNumber()
  entropyBits: number;

  @ApiProperty({ enum: ['legivel', 'ciphertext', 'inconclusivo'] })
  @IsIn(['legivel', 'ciphertext', 'inconclusivo'])
  classification: 'legivel' | 'ciphertext' | 'inconclusivo';
}
