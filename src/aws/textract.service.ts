import { Injectable, Logger } from '@nestjs/common';
import {
  TextractClient,
  DetectDocumentTextCommand,
  Block,
} from '@aws-sdk/client-textract';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import OpenAI from 'openai';
import { Readable } from 'stream';

export interface OcrResult {
  ocr_name: string | null;
  ocr_dob: string | null;
  ocr_id_number: string | null;
  ocr_address: string | null;
  id_type_detected: string | null;
  confidence: {
    name: number | null;
    dob: number | null;
    id_number: number | null;
    address: number | null;
  };
}

const EXTRACTION_PROMPT = `You are a KYC data extraction assistant for an Indian hostel check-in system.

You will be given raw text extracted via OCR from an Indian government ID document (Aadhaar card, Voter ID, Driving Licence, or Passport).

Your task is to extract the following fields and return ONLY valid JSON with no explanation or markdown:

{
  "id_type": "AADHAAR" | "VOTER_ID" | "DRIVING_LICENCE" | "PASSPORT" | "UNKNOWN",
  "full_name": "<full name as on document, or null>",
  "date_of_birth": "<DD/MM/YYYY or YYYY-MM-DD format, or null>",
  "id_number": "<the document's unique ID/number, or null>",
  "address": "<full permanent address as on document, or null>",
  "confidence": {
    "name": <0.0–1.0 or null>,
    "dob": <0.0–1.0 or null>,
    "id_number": <0.0–1.0 or null>,
    "address": <0.0–1.0 or null>
  }
}

Identification hints:
- Aadhaar: 12-digit number (often split as "XXXX XXXX XXXX"), "Unique Identification Authority of India", "आधार"
- Voter ID: starts with letters (e.g. "ABC1234567"), "Election Commission of India", "EPIC No"
- Driving Licence: alphanumeric, starts with state code (e.g. "MH01 20110012345"), "Driving Licence"
- Passport: 8 chars (letter + 7 digits, e.g. "A1234567"), "Republic of India", "Passport No"

For address: combine all address lines into one string.
For name: on Aadhaar, name is usually on the line before the DOB, or after "नाम" / "Name". Use the English name if bilingual.
Return null for any field you cannot extract with reasonable confidence.`;

@Injectable()
export class TextractService {
  private readonly logger = new Logger(TextractService.name);
  private readonly textract: TextractClient;
  private readonly s3: S3Client;
  private readonly openai: OpenAI;
  private readonly bucket: string;

  constructor() {
    const region = process.env.AWS_REGION ?? 'ap-south-1';
    this.bucket = process.env.AWS_S3_KYC_BUCKET ?? 'vibehouse-kyc-documents';

    this.textract = new TextractClient({
      region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
      },
    });

    this.s3 = new S3Client({
      region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
      },
    });

    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  /**
   * Hybrid OCR pipeline for guest KYC:
   * 1. Download image(s) from S3 as bytes
   * 2. Textract DetectDocumentText  →  raw text lines
   * 3. GPT-4o-mini                  →  structured field extraction
   */
  async analyzeId(
    frontImageKey: string,
    backImageKey?: string,
  ): Promise<OcrResult> {
    const rawLines: string[] = [];

    // Download front from S3 and run Textract
    try {
      const frontBytes = await this.downloadFromS3(frontImageKey);
      const lines = await this.detectText(frontBytes);
      rawLines.push(...lines);
      this.logger.log(`Textract front (${frontImageKey}): ${lines.length} lines`);
    } catch (err) {
      this.logger.warn(`Textract front failed: ${(err as Error).message}`);
    }

    // Download back from S3 and run Textract (if provided)
    if (backImageKey) {
      try {
        const backBytes = await this.downloadFromS3(backImageKey);
        const lines = await this.detectText(backBytes);
        rawLines.push(...lines);
        this.logger.log(`Textract back (${backImageKey}): ${lines.length} lines`);
      } catch (err) {
        this.logger.warn(`Textract back failed: ${(err as Error).message}`);
      }
    }

    if (rawLines.length === 0) {
      this.logger.warn('No text extracted — returning empty OcrResult');
      return this.emptyResult();
    }

    // GPT-4o-mini extraction
    return this.extractWithGpt(rawLines);
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async downloadFromS3(key: string): Promise<Uint8Array> {
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    const resp = await this.s3.send(cmd);
    const body = resp.Body as Readable;

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      body.on('data', (c: Buffer) => chunks.push(c));
      body.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
      body.on('error', reject);
    });
  }

  private async detectText(imageBytes: Uint8Array): Promise<string[]> {
    const cmd = new DetectDocumentTextCommand({
      Document: { Bytes: imageBytes },
    });
    const resp = await this.textract.send(cmd);
    return this.extractLines(resp.Blocks ?? []);
  }

  private extractLines(blocks: Block[]): string[] {
    return blocks
      .filter((b) => b.BlockType === 'LINE' && b.Text && b.Text.trim().length > 0)
      .map((b) => b.Text!.trim());
  }

  private async extractWithGpt(rawLines: string[]): Promise<OcrResult> {
    const rawText = rawLines.join('\n');
    this.logger.log(`Sending ${rawLines.length} lines to GPT-4o-mini`);

    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 512,
        messages: [
          { role: 'system', content: EXTRACTION_PROMPT },
          { role: 'user', content: `Here is the raw OCR text:\n\n${rawText}` },
        ],
      });

      const raw = completion.choices[0]?.message?.content?.trim() ?? '{}';
      const jsonStr = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      const parsed = JSON.parse(jsonStr);

      this.logger.log(
        `GPT extracted: name="${parsed.full_name}" id="${parsed.id_number}" type="${parsed.id_type}"`,
      );

      return {
        ocr_name: parsed.full_name ?? null,
        ocr_dob: parsed.date_of_birth ?? null,
        ocr_id_number: parsed.id_number ?? null,
        ocr_address: parsed.address ?? null,
        id_type_detected: parsed.id_type ?? null,
        confidence: {
          name: parsed.confidence?.name ?? null,
          dob: parsed.confidence?.dob ?? null,
          id_number: parsed.confidence?.id_number ?? null,
          address: parsed.confidence?.address ?? null,
        },
      };
    } catch (err) {
      this.logger.error(`GPT extraction failed: ${(err as Error).message}`);
      return this.emptyResult();
    }
  }

  private emptyResult(): OcrResult {
    return {
      ocr_name: null,
      ocr_dob: null,
      ocr_id_number: null,
      ocr_address: null,
      id_type_detected: null,
      confidence: { name: null, dob: null, id_number: null, address: null },
    };
  }
}
