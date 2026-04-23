import {
  IsString, IsInt, IsOptional, IsIn, IsArray, ValidateNested,
  IsEmail, MinLength, Min, Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ColiveGuestDetailsDto {
  @IsString()
  @MinLength(1)
  first_name: string;

  @IsString()
  @MinLength(1)
  last_name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(10)
  phone: string;
}

export class DraftAddonInputDto {
  @IsString()
  addon_id: string;

  @IsInt()
  @Min(0)
  quantity: number;
}

export class CreateCOliveDraftBookingDto {
  @IsString()
  quote_id: string;

  @IsString()
  property_id: string;

  @IsString()
  room_type_id: string;

  @IsString()
  move_in_date: string; // YYYY-MM-DD

  @IsInt()
  @Min(30)
  @Max(730)
  duration_days: number;

  @IsIn(['solo', 'couple', 'remote'])
  stay_type: 'solo' | 'couple' | 'remote';

  @ValidateNested()
  @Type(() => ColiveGuestDetailsDto)
  guest_details: ColiveGuestDetailsDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DraftAddonInputDto)
  addons: DraftAddonInputDto[];

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
