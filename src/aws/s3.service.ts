import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly region: string;

  constructor() {
    this.region = process.env.AWS_REGION ?? 'ap-south-1';
    this.bucket = process.env.AWS_S3_KYC_BUCKET ?? 'vibehouse-kyc-documents';

    this.s3 = new S3Client({
      region: this.region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
      },
    });
  }

  /**
   * Generate a presigned PUT URL for direct browser upload.
   * The frontend uploads the file to this URL via HTTP PUT.
   */
  async getPresignedUploadUrl(
    ezeeReservationId: string,
    fileName: string,
    contentType: string,
  ): Promise<{ uploadUrl: string; fileKey: string; expiresInSeconds: number }> {
    const ext = fileName.split('.').pop() ?? 'jpg';
    const uniqueId = uuidv4().slice(0, 8);
    const fileKey = `kyc/${ezeeReservationId}/${uniqueId}.${ext}`;
    const expiresIn = 300; // 5 minutes

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: fileKey,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn });

    this.logger.log(`Presigned URL generated for key: ${fileKey}`);

    return {
      uploadUrl,
      fileKey,
      expiresInSeconds: expiresIn,
    };
  }

  /**
   * Build the full S3 URL for a given file key.
   */
  buildFileUrl(fileKey: string): string {
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${fileKey}`;
  }
}
