import {
  IsNotEmpty,
  IsString,
  IsIn,
  IsBoolean,
  IsOptional,
  IsDateString,
} from 'class-validator';

export class SubmitKycDto {
  @IsNotEmpty()
  @IsString()
  @IsIn(['INDIAN'], {
    message: 'International guests — please contact the front desk for manual check-in',
  })
  nationality_type: string;

  @IsNotEmpty()
  @IsString()
  @IsIn(['AADHAAR', 'VOTER_ID', 'DRIVING_LICENCE', 'PASSPORT'], {
    message: 'Accepted IDs: Aadhaar, Voter ID, Driving Licence, Passport. PAN is not accepted.',
  })
  id_type: string;

  @IsNotEmpty()
  @IsString()
  full_name: string;

  @IsNotEmpty()
  @IsDateString()
  date_of_birth: string;

  @IsNotEmpty()
  @IsString()
  id_number: string;

  @IsNotEmpty()
  @IsString()
  permanent_address: string;

  @IsNotEmpty()
  @IsString()
  contact_number: string;

  @IsNotEmpty()
  @IsString()
  coming_from: string;

  @IsNotEmpty()
  @IsString()
  going_to: string;

  @IsNotEmpty()
  @IsString()
  @IsIn(['BUSINESS', 'LEISURE', 'MEDICAL', 'TRANSIT', 'OTHER'], {
    message: 'Purpose must be one of: BUSINESS, LEISURE, MEDICAL, TRANSIT, OTHER',
  })
  purpose: string;

  @IsOptional()
  @IsString()
  front_image_url?: string;

  @IsOptional()
  @IsString()
  back_image_url?: string;

  @IsNotEmpty()
  @IsBoolean()
  consent_given: boolean;
}
