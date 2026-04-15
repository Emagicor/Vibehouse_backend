import { IsNotEmpty, IsString } from 'class-validator';

export class LookupBookingDto {
  @IsNotEmpty()
  @IsString()
  booking_id: string;
}
