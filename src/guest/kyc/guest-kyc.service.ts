import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../../aws/s3.service';
import { TextractService } from '../../aws/textract.service';
import { SubmitKycDto } from './dto/submit-kyc.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class GuestKycService {
  private readonly logger = new Logger(GuestKycService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly textract: TextractService,
  ) {}

  // ── Helpers ─────────────────────────────────────────────────────────────

  /**
   * Verify the guest has APPROVED booking access to the ERI.
   */
  private async verifyBookingAccess(
    guestId: string,
    eri: string,
  ): Promise<void> {
    const access = await this.prisma.booking_guest_access.findFirst({
      where: {
        guest_id: guestId,
        ezee_reservation_id: eri,
        status: 'APPROVED',
      },
    });

    if (!access) {
      throw new ForbiddenException(
        'You do not have access to this booking',
      );
    }
  }

  /**
   * A slot is editable by any linked guest unless ops have VERIFIED it.
   */
  private canEditSlot(slot: { kyc_status: string }): boolean {
    return slot.kyc_status !== 'VERIFIED';
  }

  // ── Route 1: List Slots ─────────────────────────────────────────────────

  async listSlots(guestId: string, eri: string) {
    await this.verifyBookingAccess(guestId, eri);

    const slots = await this.prisma.booking_slots.findMany({
      where: { ezee_reservation_id: eri },
      include: {
        guests: {
          select: { id: true, name: true, phone: true },
        },
      },
      orderBy: { slot_number: 'asc' },
    });

    if (slots.length === 0) {
      throw new NotFoundException(
        'No slots found for this booking. Please link the booking first via POST /guest/booking/link.',
      );
    }

    return {
      ezee_reservation_id: eri,
      total_slots: slots.length,
      slots: slots.map((s) => ({
        slot_id: s.id,
        slot_number: s.slot_number,
        label: s.label,
        guest_id: s.guest_id,
        guest_name: s.guests?.name ?? null,
        kyc_status: s.kyc_status,
        can_edit: this.canEditSlot(s),
      })),
    };
  }

  // ── Route 2: Get Slot KYC Detail ────────────────────────────────────────

  async getSlotDetail(guestId: string, eri: string, slotId: string) {
    await this.verifyBookingAccess(guestId, eri);

    const slot = await this.prisma.booking_slots.findFirst({
      where: { id: slotId, ezee_reservation_id: eri },
      include: {
        guests: {
          select: { id: true, name: true, phone: true, email: true },
        },
      },
    });

    if (!slot) {
      throw new NotFoundException('Slot not found');
    }

    // Find KYC submission for this slot
    const kyc = await this.prisma.kyc_submissions.findFirst({
      where: { slot_id: slotId },
      orderBy: { created_at: 'desc' },
    });

    return {
      slot: {
        slot_id: slot.id,
        slot_number: slot.slot_number,
        label: slot.label,
        guest_id: slot.guest_id,
        guest_name: slot.guests?.name ?? null,
        kyc_status: slot.kyc_status,
      },
      kyc: kyc
        ? {
            id: kyc.id,
            nationality_type: kyc.nationality_type,
            id_type: kyc.id_type,
            full_name: kyc.full_name,
            date_of_birth: kyc.date_of_birth,
            id_number: kyc.id_number,
            permanent_address: kyc.permanent_address,
            contact_number: kyc.contact_number,
            coming_from: kyc.coming_from,
            going_to: kyc.going_to,
            purpose: kyc.purpose,
            front_image_url: kyc.front_image_url,
            back_image_url: kyc.back_image_url,
            ocr_name: kyc.ocr_name,
            ocr_dob: kyc.ocr_dob,
            ocr_id_number: kyc.ocr_id_number,
            ocr_address: kyc.ocr_address,
            consent_given: kyc.consent_given,
            status: kyc.status,
            submitted_at: kyc.submitted_at,
            submitted_by_guest_id: kyc.submitted_by_guest_id,
          }
        : null,
    };
  }

  // ── Route 3: Get Presigned Upload URL ───────────────────────────────────

  async getUploadUrl(
    guestId: string,
    eri: string,
    fileName: string,
    contentType: string,
  ) {
    await this.verifyBookingAccess(guestId, eri);

    return this.s3.getPresignedUploadUrl(eri, fileName, contentType);
  }

  // ── Route 4: Run OCR ───────────────────────────────────────────────────

  async runOcr(
    guestId: string,
    eri: string,
    slotId: string,
    frontImageKey: string,
    backImageKey?: string,
  ) {
    await this.verifyBookingAccess(guestId, eri);

    const slot = await this.prisma.booking_slots.findFirst({
      where: { id: slotId, ezee_reservation_id: eri },
    });

    if (!slot) {
      throw new NotFoundException('Slot not found');
    }

    if (!this.canEditSlot(slot)) {
      throw new ForbiddenException('You cannot edit this slot — it has been verified by ops.');
    }

    const ocrResult = await this.textract.analyzeId(
      frontImageKey,
      backImageKey,
    );

    this.logger.log(
      `OCR completed for slot ${slotId}: name="${ocrResult.ocr_name}"`,
    );

    return ocrResult;
  }

  // ── Route 5: Submit KYC ─────────────────────────────────────────────────

  async submitKyc(
    guestId: string,
    eri: string,
    slotId: string,
    dto: SubmitKycDto,
  ) {
    await this.verifyBookingAccess(guestId, eri);

    // 1. Verify slot exists and is editable
    const slot = await this.prisma.booking_slots.findFirst({
      where: { id: slotId, ezee_reservation_id: eri },
    });

    if (!slot) {
      throw new NotFoundException('Slot not found');
    }

    if (!this.canEditSlot(slot)) {
      throw new ForbiddenException(
        'You cannot edit this slot. It has been verified by ops and is now locked.',
      );
    }

    // 2. Validate consent
    if (!dto.consent_given) {
      throw new BadRequestException(
        'You must confirm that the information is correct (consent_given: true)',
      );
    }

    // 3. Validate age ≥ 18
    const dob = new Date(dto.date_of_birth);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
      age--;
    }

    if (age < 18) {
      throw new BadRequestException(
        'Guest must be 18 years or older. The provided date of birth indicates an age under 18.',
      );
    }

    // 4. Determine the guest_id for the KYC row
    // If the slot has an assigned guest, use that. Otherwise use the caller.
    const kycGuestId = slot.guest_id ?? guestId;

    // 5. Check if a KYC already exists for this slot — update or create
    const existingKyc = await this.prisma.kyc_submissions.findFirst({
      where: { slot_id: slotId },
    });

    const kycData = {
      ezee_reservation_id: eri,
      guest_id: kycGuestId,
      slot_id: slotId,
      nationality_type: dto.nationality_type,
      id_type: dto.id_type,
      full_name: dto.full_name,
      date_of_birth: dob,
      id_number: dto.id_number,
      permanent_address: dto.permanent_address,
      contact_number: dto.contact_number,
      coming_from: dto.coming_from,
      going_to: dto.going_to,
      purpose: dto.purpose,
      front_image_url: dto.front_image_url ?? null,
      back_image_url: dto.back_image_url ?? null,
      consent_given: dto.consent_given,
      status: 'PRE_VERIFIED',
      submitted_at: new Date(),
      submitted_by_guest_id: guestId,
    };

    let kycId: string;

    if (existingKyc) {
      await this.prisma.kyc_submissions.update({
        where: { id: existingKyc.id },
        data: kycData,
      });
      kycId = existingKyc.id;
    } else {
      const newKyc = await this.prisma.kyc_submissions.create({
        data: { id: uuidv4(), ...kycData },
      });
      kycId = newKyc.id;
    }

    // 6. Update slot KYC status
    await this.prisma.booking_slots.update({
      where: { id: slotId },
      data: { kyc_status: 'PRE_VERIFIED' },
    });

    this.logger.log(
      `KYC submitted for slot ${slotId} by guest ${guestId}: ${dto.full_name} — ${dto.id_type}`,
    );

    return {
      message: 'KYC submitted successfully — pending on-site verification',
      kyc_id: kycId,
      slot_id: slotId,
      status: 'PRE_VERIFIED',
      full_name: dto.full_name,
    };
  }

  // ── Route 6: Add Slot ───────────────────────────────────────────────────

  async addSlot(guestId: string, eri: string) {
    await this.verifyBookingAccess(guestId, eri);

    const existing = await this.prisma.booking_slots.findMany({
      where: { ezee_reservation_id: eri },
      orderBy: { slot_number: 'desc' },
    });

    const nextNumber = (existing[0]?.slot_number ?? 0) + 1;

    const newSlot = await this.prisma.booking_slots.create({
      data: {
        id: uuidv4(),
        ezee_reservation_id: eri,
        slot_number: nextNumber,
        label: `Guest ${nextNumber}`,
        guest_id: null,
        kyc_status: 'NOT_STARTED',
      },
    });

    this.logger.log(`Slot ${nextNumber} added to booking ${eri} by guest ${guestId}`);

    return {
      slot_id: newSlot.id,
      slot_number: newSlot.slot_number,
      label: newSlot.label,
      kyc_status: newSlot.kyc_status,
      guest_id: null,
    };
  }

  // ── Route 7: Delete Slot ────────────────────────────────────────────────

  async deleteSlot(guestId: string, eri: string, slotId: string) {
    await this.verifyBookingAccess(guestId, eri);

    const slot = await this.prisma.booking_slots.findFirst({
      where: { id: slotId, ezee_reservation_id: eri },
    });

    if (!slot) {
      throw new NotFoundException('Slot not found');
    }

    if (slot.kyc_status === 'VERIFIED') {
      throw new ForbiddenException(
        'This slot has been verified by ops and cannot be deleted.',
      );
    }

    // Delete KYC submission first (FK), then the slot
    await this.prisma.kyc_submissions.deleteMany({ where: { slot_id: slotId } });
    await this.prisma.booking_slots.delete({ where: { id: slotId } });

    this.logger.log(`Slot ${slotId} ("${slot.label}") deleted from booking ${eri} by guest ${guestId}`);

    return { message: `Slot "${slot.label}" deleted successfully` };
  }
}
