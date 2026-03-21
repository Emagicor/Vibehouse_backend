import {
  IsString,
  IsNotEmpty,
  IsDateString,
  IsArray,
  ValidateNested,
  IsInt,
  Min,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';

export class RoomSelectionDto {
  @IsString()
  @IsNotEmpty()
  room_type_id: string;

  @IsInt()
  @Min(1)
  quantity: number; // number of beds (dorm) or rooms (private)
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
