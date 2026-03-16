import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class RequestServiceDto {
  @IsString()
  @IsNotEmpty()
  product_id: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
