import { IsString, IsNotEmpty } from 'class-validator';

export class CreatePaymentOrderDto {
  @IsString()
  @IsNotEmpty()
  ezee_reservation_id: string;
}
