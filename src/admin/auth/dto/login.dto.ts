import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class AdminLoginDto {
  @IsEmail()
  email: string;

  @IsNotEmpty()
  @IsString()
  password: string;

  @IsNotEmpty()
  @IsString()
  role: string; // OWNER | MANAGER | RECEPTION | HOUSEKEEPING_LEAD | MAINTENANCE_LEAD
}
