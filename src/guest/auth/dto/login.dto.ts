import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class GuestLoginDto {
  @IsEmail()
  email: string;

  @IsNotEmpty()
  @IsString()
  password: string;
}
