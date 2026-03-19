import { IsNotEmpty, IsString } from 'class-validator';

export class UploadUrlDto {
  @IsNotEmpty()
  @IsString()
  file_name: string;

  @IsNotEmpty()
  @IsString()
  content_type: string;
}
