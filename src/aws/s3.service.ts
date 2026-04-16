import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  PutBucketCorsCommand,
  GetBucketCorsCommand,
} from '@aws-sdk/client-s3';
import type { Readable } from 'stream';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class S3Service implements OnModuleInit {
  private readonly logger = new Logger(S3Service.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly region: string;

  constructor() {
    this.region = process.env.AWS_REGION ?? 'ap-south-1';
    this.bucket = process.env.AWS_S3_KYC_BUCKET ?? 'vibehouse-kyc-documents';

    this.s3 = new S3Client({ region: this.region });
  }

  async onModuleInit() {
    await this.ensureCorsConfig();
  }

  /**
   * Ensure the S3 bucket has CORS configured for browser uploads.
   */
  private async ensureCorsConfig() {
    try {
      const existing = await this.s3.send(
        new GetBucketCorsCommand({ Bucket: this.bucket }),
      );
      if (existing.CORSRules && existing.CORSRules.length > 0) {
        this.logger.log('S3 CORS already configured');
        return;
      }
    } catch (err: any) {
      if (err.name !== 'NoSuchCORSConfiguration') {
        this.logger.warn(`Could not check S3 CORS: ${err.message}`);
        return;
      }
    }

    try {
      await this.s3.send(
        new PutBucketCorsCommand({
          Bucket: this.bucket,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedOrigins: ['*'],
                AllowedMethods: ['GET', 'PUT', 'POST', 'HEAD'],
                AllowedHeaders: ['*'],
                ExposeHeaders: ['ETag'],
                MaxAgeSeconds: 3600,
              },
            ],
          },
        }),
      );
      this.logger.log('S3 CORS configured successfully');
    } catch (err: any) {
      this.logger.warn(`Failed to set S3 CORS (set it manually): ${err.message}`);
    }
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
   * Generate a presigned PUT URL for a custom path prefix.
   * Used for event posters, etc.
   */
  async getPresignedUploadUrlForPath(
    pathPrefix: string,
    fileName: string,
    contentType: string,
  ): Promise<{ uploadUrl: string; fileKey: string; fileUrl: string; expiresInSeconds: number }> {
    const ext = fileName.split('.').pop() ?? 'jpg';
    const uniqueId = uuidv4().slice(0, 8);
    const fileKey = `${pathPrefix}/${uniqueId}.${ext}`;
    const expiresIn = 300;

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
      fileUrl: this.buildFileUrl(fileKey),
      expiresInSeconds: expiresIn,
    };
  }

  /**
   * Upload a file buffer to S3 (server-side, no CORS needed).
   */
  async uploadFile(
    pathPrefix: string,
    fileName: string,
    contentType: string,
    buffer: Buffer,
  ): Promise<{ fileKey: string; fileUrl: string }> {
    const ext = fileName.split('.').pop() ?? 'jpg';
    const uniqueId = uuidv4().slice(0, 8);
    const fileKey = `${pathPrefix}/${uniqueId}.${ext}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: fileKey,
        ContentType: contentType,
        Body: buffer,
      }),
    );

    this.logger.log(`File uploaded: ${fileKey}`);

    return { fileKey, fileUrl: this.buildFileUrl(fileKey) };
  }

  /**
   * Stream an S3 object by key (for proxying images to the browser).
   */
  async getObjectStream(
    key: string,
  ): Promise<{ stream: Readable; contentType: string }> {
    const response = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return {
      stream: response.Body as Readable,
      contentType: response.ContentType ?? 'application/octet-stream',
    };
  }

  /**
   * Generate a presigned GET URL for viewing/downloading a file.
   * Default TTL 15 minutes — long enough to open in a browser tab.
   */
  async getPresignedDownloadUrl(
    key: string,
    expiresIn = 900,
  ): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.s3, command, { expiresIn });
  }

  /**
   * Delete an object from S3 by key.
   */
  async deleteObject(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    this.logger.log(`S3 object deleted: ${key}`);
  }

  /**
   * Extract the S3 key from either a full S3 URL or a bare key.
   * e.g. "https://bucket.s3.region.amazonaws.com/kyc/ERI/uuid.jpg" → "kyc/ERI/uuid.jpg"
   */
  extractKey(urlOrKey: string): string {
    if (urlOrKey.startsWith('http')) {
      const url = new URL(urlOrKey);
      return url.pathname.replace(/^\//, '');
    }
    return urlOrKey;
  }

  /**
   * Build the full S3 URL for a given file key.
   */
  buildFileUrl(fileKey: string): string {
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${fileKey}`;
  }
}
