import {
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
  IsNotEmpty,
} from 'class-validator';

export class UpdateAdminProfileDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string; // empty string = clear phone

  @IsOptional()
  @IsString()
  @MinLength(8)
  new_password?: string;

  @IsOptional()
  @IsString()
  current_password?: string; // required when self is changing password
}
