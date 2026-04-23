import { IsNumber, IsPositive, Max } from 'class-validator';

export class UpdateColivePriceDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(999999)
  colive_price_month: number;
}
