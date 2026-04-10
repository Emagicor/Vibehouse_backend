import { IsString, IsNumber, IsOptional, IsIn, Min, Max } from 'class-validator';

export class SearchColiveDto {
  @IsString()
  location_id: string;

  @IsString()
  location_slug: string;

  @IsString()
  move_in_date: string; // ISO date YYYY-MM-DD

  @IsNumber()
  @Min(1)
  @Max(24)
  duration_months: number;

  @IsIn(['solo', 'couple', 'remote'])
  stay_type: 'solo' | 'couple' | 'remote';

  @IsOptional()
  @IsString()
  selected_plan_id?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  guest_count?: number;

  @IsOptional()
  @IsString()
  currency?: string;
}
