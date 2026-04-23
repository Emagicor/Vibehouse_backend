import {
  IsString, IsInt, IsOptional, IsIn, IsArray, ValidateNested, Min, Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class QuoteAddonInputDto {
  @IsString()
  addon_id: string;

  @IsInt()
  @Min(0)
  quantity: number;
}

export class CreateColiveQuoteDto {
  @IsString()
  property_id: string;

  @IsString()
  move_in_date: string; // YYYY-MM-DD

  @IsInt()
  @Min(30)
  @Max(730)
  duration_days: number;

  @IsIn(['solo', 'couple', 'remote'])
  stay_type: 'solo' | 'couple' | 'remote';

  @IsString()
  room_type_id: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuoteAddonInputDto)
  addons: QuoteAddonInputDto[];

  @IsOptional()
  @IsString()
  coupon_code?: string;
}
