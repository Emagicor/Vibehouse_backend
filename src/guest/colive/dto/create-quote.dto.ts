import {
  IsString, IsNumber, IsOptional, IsIn, IsArray, ValidateNested, Min, Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class QuoteAddonInputDto {
  @IsString()
  addon_id: string;

  @IsNumber()
  @Min(0)
  quantity: number;
}

export class CreateColiveQuoteDto {
  @IsString()
  property_id: string;

  @IsString()
  move_in_date: string; // YYYY-MM-DD

  @IsNumber()
  @Min(1)
  @Max(24)
  duration_months: number;

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
