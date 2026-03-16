import { IsString, IsNotEmpty } from 'class-validator';

export class BorrowableCheckoutDto {
  @IsString()
  @IsNotEmpty()
  guest_id: string;

  @IsString()
  @IsNotEmpty()
  ezee_reservation_id: string;
}
