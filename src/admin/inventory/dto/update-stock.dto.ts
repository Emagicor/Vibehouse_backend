import { IsOptional, IsNumber, Min } from 'class-validator';

export class UpdateStockDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  low_stock_threshold?: number;
}
