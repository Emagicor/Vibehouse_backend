import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsNumber,
  IsIn,
  Min,
} from 'class-validator';

export class CreateProductDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNotEmpty()
  @IsIn(['COMMODITY', 'SERVICE', 'BORROWABLE', 'RETURNABLE'])
  category: string;

  @IsNumber()
  @Min(0)
  base_price: number;

  @IsNotEmpty()
  @IsString()
  property_id: string;

  // Initial stock — only meaningful for COMMODITY / BORROWABLE
  @IsOptional()
  @IsNumber()
  @Min(0)
  initial_stock?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  low_stock_threshold?: number;
}
