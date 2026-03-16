import { IsNumber, Min } from 'class-validator';

export class RestockDto {
  @IsNumber()
  @Min(1)
  quantity: number;
}
