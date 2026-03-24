import { IsNotEmpty, IsIn, IsOptional, IsString } from 'class-validator';

export class ReturnableReturnDto {
  @IsNotEmpty()
  @IsIn(['GOOD', 'DAMAGED', 'LOST'])
  condition: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
