import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  TextractClient,
  DetectDocumentTextCommand,
  Block,
} from '@aws-sdk/client-textract';
import OpenAI from 'openai';
import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../../aws/s3.service';

export interface OcrTestResult {
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
  raw_text_lines: string[];
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
  ) {
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

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST ALL KYCs — grouped by guest → booking → slot
  // ═══════════════════════════════════════════════════════════════════════════

  async listAllKycs(actorPropertyId: string | null) {
    const where: any = {};
    if (actorPropertyId) where.property_id = actorPropertyId;

    const bookings = await this.prisma.ezee_booking_cache.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: {
        guests: { select: { id: true, name: true, email: true, phone: true } },
        properties: { select: { id: true, name: true } },
        booking_slots: {
          orderBy: { slot_number: 'asc' },
          include: {
            kyc_submissions: {
              orderBy: { created_at: 'desc' },
              take: 1,
            },
          },
        },
      },
    });

    // Group by booker guest_id
    const guestMap = new Map<string, {
      guest: { id: string; name: string; email: string | null; phone: string | null };
      bookings: {
        eri: string;
        property: { id: string; name: string } | null;
        checkin_date: Date | null;
        checkout_date: Date | null;
        status: string | null;
        slots: {
          slot_id: string;
          slot_number: number;
          label: string;
          kyc_status: string;
          kyc: {
            id: string;
            full_name: string | null;
            id_type: string | null;
            id_number: string | null;
            nationality_type: string | null;
            date_of_birth: Date | null;
            permanent_address: string | null;
            contact_number: string | null;
            coming_from: string | null;
            going_to: string | null;
            purpose: string | null;
            has_front_image: boolean;
            has_back_image: boolean;
            status: string | null;
            submitted_at: Date | null;
            consent_given: boolean | null;
          } | null;
        }[];
      }[];
    }>();

    for (const booking of bookings) {
      if (!booking.guests) continue;

      const g = booking.guests;
      if (!guestMap.has(g.id)) {
        guestMap.set(g.id, { guest: g, bookings: [] });
      }

      const sub = booking.booking_slots.map((s) => {
        const kyc = s.kyc_submissions[0] ?? null;
        return {
          slot_id: s.id,
          slot_number: s.slot_number,
          label: s.label,
          kyc_status: s.kyc_status,
          kyc: kyc
            ? {
                id: kyc.id,
                full_name: kyc.full_name,
                id_type: kyc.id_type,
                id_number: kyc.id_number,
                nationality_type: kyc.nationality_type,
                date_of_birth: kyc.date_of_birth,
                permanent_address: kyc.permanent_address,
                contact_number: kyc.contact_number,
                coming_from: kyc.coming_from,
                going_to: kyc.going_to,
                purpose: kyc.purpose,
                has_front_image: !!kyc.front_image_url,
                has_back_image: !!kyc.back_image_url,
                status: kyc.status,
                submitted_at: kyc.submitted_at,
                consent_given: kyc.consent_given,
              }
            : null,
        };
      });

      guestMap.get(g.id)!.bookings.push({
        eri: booking.ezee_reservation_id,
        property: booking.properties ?? null,
        checkin_date: booking.checkin_date,
        checkout_date: booking.checkout_date,
        status: booking.status,
        slots: sub,
      });
    }

    return Array.from(guestMap.values());
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET PRESIGNED DOCUMENT URLS for a slot
  // ═══════════════════════════════════════════════════════════════════════════

  async getDocumentUrls(slotId: string, actorPropertyId: string | null) {
    const slot = await this.prisma.booking_slots.findUnique({
      where: { id: slotId },
      include: {
        ezee_booking_cache: { select: { property_id: true } },
      },
    });

    if (!slot) throw new NotFoundException('Slot not found');

    if (actorPropertyId && slot.ezee_booking_cache?.property_id !== actorPropertyId) {
      throw new NotFoundException('Slot not found');
    }

    const kyc = await this.prisma.kyc_submissions.findFirst({
      where: { slot_id: slotId },
      orderBy: { created_at: 'desc' },
    });

    if (!kyc) throw new NotFoundException('No KYC submission found for this slot');

    const frontUrl = kyc.front_image_url
      ? await this.s3.getPresignedDownloadUrl(this.s3.extractKey(kyc.front_image_url))
      : null;

    const backUrl = kyc.back_image_url
      ? await this.s3.getPresignedDownloadUrl(this.s3.extractKey(kyc.back_image_url))
      : null;

    return {
      slot_id: slotId,
      front_image_url: frontUrl,
      back_image_url: backUrl,
      expires_in_seconds: 900,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DELETE A KYC DOCUMENT IMAGE
  // ═══════════════════════════════════════════════════════════════════════════

  async deleteDocument(
    slotId: string,
    imageType: 'front' | 'back',
    actorPropertyId: string | null,
  ) {
    const slot = await this.prisma.booking_slots.findUnique({
      where: { id: slotId },
      include: {
        ezee_booking_cache: { select: { property_id: true } },
      },
    });

    if (!slot) throw new NotFoundException('Slot not found');

    if (actorPropertyId && slot.ezee_booking_cache?.property_id !== actorPropertyId) {
      throw new NotFoundException('Slot not found');
    }

    const kyc = await this.prisma.kyc_submissions.findFirst({
      where: { slot_id: slotId },
      orderBy: { created_at: 'desc' },
    });

    if (!kyc) throw new NotFoundException('No KYC submission found for this slot');

    const field = imageType === 'front' ? 'front_image_url' : 'back_image_url';
    const currentValue = kyc[field];

    if (!currentValue) {
      throw new BadRequestException(`No ${imageType} image exists for this slot`);
    }

    // Delete from S3
    await this.s3.deleteObject(this.s3.extractKey(currentValue));

    // Clear DB field
    await this.prisma.kyc_submissions.update({
      where: { id: kyc.id },
      data: { [field]: null },
    });

    this.logger.log(`KYC ${imageType} image deleted for slot ${slotId}`);

    return { message: `${imageType} image deleted successfully`, slot_id: slotId };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // OCR TEST (existing)
  // ═══════════════════════════════════════════════════════════════════════════

  async testOcr(
    frontImageBase64: string,
    backImageBase64?: string,
  ): Promise<OcrTestResult> {
    const toBytes = (b64: string): Uint8Array => {
      const clean = b64.includes(',') ? b64.split(',')[1] : b64;
      return new Uint8Array(Buffer.from(clean, 'base64'));
    };

    const rawLines: string[] = [];

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
        ocr_name: null, ocr_dob: null, ocr_id_number: null, ocr_address: null,
        id_type_detected: null,
        confidence: { name: null, dob: null, id_number: null, address: null },
        raw_text_lines: [],
        error: 'Textract could not extract any text from the image(s).',
      };
    }

    const rawText = rawLines.join('\n');
    this.logger.log(`Sending ${rawLines.length} lines to GPT-4o-mini for extraction`);

    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 512,
        messages: [
          { role: 'system', content: EXTRACTION_PROMPT },
          { role: 'user', content: `Here is the raw OCR text from the ID document:\n\n${rawText}` },
        ],
      });

      const raw = completion.choices[0]?.message?.content?.trim() ?? '{}';
      this.logger.log(`GPT-4o-mini response: ${raw.substring(0, 200)}`);

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
        ocr_name: null, ocr_dob: null, ocr_id_number: null, ocr_address: null,
        id_type_detected: null,
        confidence: { name: null, dob: null, id_number: null, address: null },
        raw_text_lines: rawLines,
        error: `LLM extraction failed: ${msg}`,
      };
    }
  }

  private extractLines(blocks: Block[]): string[] {
    return blocks
      .filter((b) => b.BlockType === 'LINE' && b.Text && b.Text.trim().length > 0)
      .map((b) => b.Text!.trim());
  }
}
