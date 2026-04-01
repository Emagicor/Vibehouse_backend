import {
  IsString,
  IsNotEmpty,
  IsDateString,
  IsArray,
  ValidateNested,
  IsInt,
  Min,
  IsOptional,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

export class GuestDetailDto {
  @IsString()
  @IsNotEmpty()
  first_name: string;

  @IsString()
  @IsNotEmpty()
  last_name: string;

  @IsOptional()
  @IsIn(['Male', 'Female', 'Other'])
  gender?: string;
}

export class RoomSelectionDto {
  @IsString()
  @IsNotEmpty()
  room_type_id: string;

  @IsInt()
  @Min(1)
  quantity: number; // number of beds (dorm) or rooms (private)

  /**
   * Per-bed guest details. Length must equal quantity.
   * If omitted, the booker's name is used for all beds.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GuestDetailDto)
  guests?: GuestDetailDto[];
}

export class AddonSelectionDto {
  @IsString()
  @IsNotEmpty()
  product_id: string;

  @IsInt()
  @Min(1)
  quantity: number;
}

export class CreateBookingOrderDto {
  @IsString()
  @IsNotEmpty()
  property_id: string;

  @IsDateString()
  checkin_date: string;

  @IsDateString()
  checkout_date: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoomSelectionDto)
  rooms: RoomSelectionDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddonSelectionDto)
  addons?: AddonSelectionDto[];
}
