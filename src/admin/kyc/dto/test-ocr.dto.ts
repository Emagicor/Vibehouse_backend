import { IsNotEmpty, IsString, IsOptional, MaxLength } from 'class-validator';

export class TestOcrDto {
  /**
   * Base64-encoded image string (with or without data URI prefix).
   * Max ~5MB image (base64 inflates by ~33%).
   */
  @IsNotEmpty()
  @IsString()
  @MaxLength(7_000_000) // ~5MB base64
  front_image_base64: string;

  @IsOptional()
  @IsString()
  @MaxLength(7_000_000)
  back_image_base64?: string;
}
