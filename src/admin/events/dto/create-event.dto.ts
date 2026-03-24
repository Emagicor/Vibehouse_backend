import { IsString, IsOptional, IsDateString, IsInt, MaxLength, Min } from 'class-validator';

export class CreateEventDto {
  @IsString()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  time?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  price_text?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  contact_link?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  poster_url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  badge_label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  badge_color?: string;
}
