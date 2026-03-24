import { IsNotEmpty, IsString, IsOptional, IsNumber, Min } from 'class-validator';

export class ReturnableIssueDto {
  @IsNotEmpty()
  @IsString()
  guest_id: string;

  @IsNotEmpty()
  @IsString()
  ezee_reservation_id: string;

  @IsNotEmpty()
  @IsString()
  addon_order_item_id: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  quantity?: number;
}
