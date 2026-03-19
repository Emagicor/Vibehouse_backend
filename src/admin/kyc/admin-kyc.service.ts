import { Injectable, Logger } from '@nestjs/common';
import {
  TextractClient,
  DetectDocumentTextCommand,
  Block,
} from '@aws-sdk/client-textract';
import OpenAI from 'openai';

export interface OcrTestResult {
  /** Structured fields extracted by GPT-4o-mini */
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
  /** Raw text lines extracted by Textract DetectDocumentText */
  raw_text_lines: string[];
  /** Error message if either step failed */
  error: string | null;
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
export class AdminKycService {
  private readonly logger = new Logger(AdminKycService.name);
  private readonly textract: TextractClient;
  private readonly openai: OpenAI;

  constructor() {
    this.textract = new TextractClient({
      region: process.env.AWS_REGION ?? 'ap-south-1',
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
   * Hybrid OCR pipeline:
   * 1. Textract DetectDocumentText  →  raw text lines (accurate character reading)
   * 2. GPT-4o-mini                  →  structured field extraction (context understanding)
   *
   * Nothing is stored. Images passed as raw bytes, discarded after response.
   */
  async testOcr(
    frontImageBase64: string,
    backImageBase64?: string,
  ): Promise<OcrTestResult> {
    const toBytes = (b64: string): Uint8Array => {
      const clean = b64.includes(',') ? b64.split(',')[1] : b64;
      return new Uint8Array(Buffer.from(clean, 'base64'));
    };

    // ── Step 1: Textract DetectDocumentText ─────────────────────────────────
    const rawLines: string[] = [];

    // Process front image
    try {
      const frontCmd = new DetectDocumentTextCommand({
        Document: { Bytes: toBytes(frontImageBase64) },
      });
      const frontResp = await this.textract.send(frontCmd);
      const lines = this.extractLines(frontResp.Blocks ?? []);
      rawLines.push(...lines);

      this.logger.log(`Textract front: ${lines.length} lines extracted`);
    } catch (err) {
      this.logger.warn(`Textract front failed: ${(err as Error).message}`);
    }

    // Process back image if provided
    if (backImageBase64) {
      try {
        const backCmd = new DetectDocumentTextCommand({
          Document: { Bytes: toBytes(backImageBase64) },
        });
        const backResp = await this.textract.send(backCmd);
        const lines = this.extractLines(backResp.Blocks ?? []);
        rawLines.push(...lines);

        this.logger.log(`Textract back: ${lines.length} lines extracted`);
      } catch (err) {
        this.logger.warn(`Textract back failed: ${(err as Error).message}`);
      }
    }

    if (rawLines.length === 0) {
      return {
        ocr_name: null,
        ocr_dob: null,
        ocr_id_number: null,
        ocr_address: null,
        id_type_detected: null,
        confidence: { name: null, dob: null, id_number: null, address: null },
        raw_text_lines: [],
        error: 'Textract could not extract any text from the image(s).',
      };
    }

    // ── Step 2: GPT-4o-mini structured extraction ────────────────────────────
    const rawText = rawLines.join('\n');
    this.logger.log(`Sending ${rawLines.length} lines to GPT-4o-mini for extraction`);

    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 512,
        messages: [
          { role: 'system', content: EXTRACTION_PROMPT },
          {
            role: 'user',
            content: `Here is the raw OCR text from the ID document:\n\n${rawText}`,
          },
        ],
      });

      const raw = completion.choices[0]?.message?.content?.trim() ?? '{}';
      this.logger.log(`GPT-4o-mini response: ${raw.substring(0, 200)}`);

      // Strip possible markdown code fences
      const jsonStr = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      const parsed = JSON.parse(jsonStr);

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
        raw_text_lines: rawLines,
        error: null,
      };
    } catch (err) {
      const msg = (err as Error).message;
      this.logger.error(`GPT-4o-mini extraction failed: ${msg}`);
      return {
        ocr_name: null,
        ocr_dob: null,
        ocr_id_number: null,
        ocr_address: null,
        id_type_detected: null,
        confidence: { name: null, dob: null, id_number: null, address: null },
        raw_text_lines: rawLines,
        error: `LLM extraction failed: ${msg}`,
      };
    }
  }

  /** Extract LINE-type blocks from Textract response, filtering blanks */
  private extractLines(blocks: Block[]): string[] {
    return blocks
      .filter((b) => b.BlockType === 'LINE' && b.Text && b.Text.trim().length > 0)
      .map((b) => b.Text!.trim());
  }
}
