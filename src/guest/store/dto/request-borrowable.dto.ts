import { IsString, IsNotEmpty, IsOptional, IsInt, Min } from 'class-validator';

export class RequestBorrowableDto {
  @IsString()
  @IsNotEmpty()
  product_id: string;

  /** Optional expected duration in hours (e.g. 2 = "I need it for ~2 hours") */
  @IsOptional()
  @IsInt()
  @Min(1)
  expected_duration_hours?: number;
}
