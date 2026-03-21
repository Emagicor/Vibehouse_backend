import {
  IsString,
  IsNotEmpty,
  IsDateString,
  IsArray,
  ValidateNested,
  IsOptional,
  IsInt,
  Min,
  IsEmail,
} from 'class-validator';
import { Type } from 'class-transformer';

class RoomSelectionDto {
  @IsString()
  @IsNotEmpty()
  room_type_id: string;

  @IsInt()
  @Min(1)
  quantity: number;
}

class AddonSelectionDto {
  @IsString()
  @IsNotEmpty()
  product_id: string;

  @IsInt()
  @Min(1)
  quantity: number;
}

export class CreateManualBookingDto {
  @IsString()
  @IsNotEmpty()
  property_id: string;

  @IsString()
  @IsNotEmpty()
  guest_name: string;

  @IsEmail()
  @IsOptional()
  guest_email?: string;

  @IsString()
  @IsOptional()
  guest_phone?: string;

  @IsDateString()
  checkin_date: string;

  @IsDateString()
  checkout_date: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoomSelectionDto)
  rooms: RoomSelectionDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddonSelectionDto)
  @IsOptional()
  addons?: AddonSelectionDto[];
}
