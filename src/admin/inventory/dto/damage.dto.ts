import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class DamageDto {
  @IsNumber()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
