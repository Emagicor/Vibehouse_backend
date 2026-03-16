import { IsString, IsNotEmpty, IsInt, Min } from 'class-validator';

export class AddToCartDto {
  @IsString()
  @IsNotEmpty()
  product_id: string;

  @IsInt()
  @Min(1)
  quantity: number;

  /** Bed/unit code from ezee_booking_cache — identifies which bed this item is for */
  @IsString()
  @IsNotEmpty()
  unit_code: string;
}
