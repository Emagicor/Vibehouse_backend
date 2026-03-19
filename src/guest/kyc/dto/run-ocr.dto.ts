import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class RunOcrDto {
  @IsNotEmpty()
  @IsString()
  front_image_key: string;

  @IsOptional()
  @IsString()
  back_image_key?: string;
}
