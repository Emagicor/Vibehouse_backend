import { IsNotEmpty, IsString } from 'class-validator';

export class LinkBookingDto {
  @IsNotEmpty()
  @IsString()
  ezee_reservation_id: string;
}
