import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { GuestKycService } from './guest-kyc.service';
import { UploadUrlDto } from './dto/upload-url.dto';
import { RunOcrDto } from './dto/run-ocr.dto';
import { SubmitKycDto } from './dto/submit-kyc.dto';
import { CurrentGuest } from '../../common/decorators/current-guest.decorator';
import type { GuestJwtPayload } from '../../common/guards/guest-jwt.strategy';

@Controller('guest/kyc')
@UseGuards(AuthGuard('guest-jwt'))
export class GuestKycController {
  constructor(private readonly kycService: GuestKycService) {}

  /**
   * GET /guest/kyc/:eri/slots
   * List all slots for a booking with KYC status.
   */
  @Get(':eri/slots')
  listSlots(
    @CurrentGuest() guest: GuestJwtPayload,
    @Param('eri') eri: string,
  ) {
    return this.kycService.listSlots(guest.guest_id, eri);
  }

  /**
   * POST /guest/kyc/:eri/slots/add
   * Add a new slot to an existing booking.
   * MUST be declared before GET :eri/slots/:slotId to prevent "add" being matched as slotId.
   */
  @Post(':eri/slots/add')
  addSlot(
    @CurrentGuest() guest: GuestJwtPayload,
    @Param('eri') eri: string,
  ) {
    return this.kycService.addSlot(guest.guest_id, eri);
  }

  /**
   * GET /guest/kyc/:eri/slots/:slotId
   * Get full KYC details for a specific slot.
   */
  @Get(':eri/slots/:slotId')
  getSlotDetail(
    @CurrentGuest() guest: GuestJwtPayload,
    @Param('eri') eri: string,
    @Param('slotId') slotId: string,
  ) {
    return this.kycService.getSlotDetail(guest.guest_id, eri, slotId);
  }

  /**
   * DELETE /guest/kyc/:eri/slots/:slotId
   * Delete a slot (blocked if kyc_status is VERIFIED).
   */
  @Delete(':eri/slots/:slotId')
  @HttpCode(HttpStatus.OK)
  deleteSlot(
    @CurrentGuest() guest: GuestJwtPayload,
    @Param('eri') eri: string,
    @Param('slotId') slotId: string,
  ) {
    return this.kycService.deleteSlot(guest.guest_id, eri, slotId);
  }

  /**
   * POST /guest/kyc/:eri/upload-url
   * Get a presigned S3 upload URL for document images.
   */
  @Post(':eri/upload-url')
  getUploadUrl(
    @CurrentGuest() guest: GuestJwtPayload,
    @Param('eri') eri: string,
    @Body() dto: UploadUrlDto,
  ) {
    return this.kycService.getUploadUrl(
      guest.guest_id,
      eri,
      dto.file_name,
      dto.content_type,
    );
  }

  /**
   * POST /guest/kyc/:eri/slots/:slotId/ocr
   * Run Amazon Textract + GPT-4o-mini OCR on uploaded document images.
   */
  @Post(':eri/slots/:slotId/ocr')
  runOcr(
    @CurrentGuest() guest: GuestJwtPayload,
    @Param('eri') eri: string,
    @Param('slotId') slotId: string,
    @Body() dto: RunOcrDto,
  ) {
    return this.kycService.runOcr(
      guest.guest_id,
      eri,
      slotId,
      dto.front_image_key,
      dto.back_image_key,
    );
  }

  /**
   * POST /guest/kyc/:eri/slots/:slotId/submit
   * Submit the final reviewed KYC form.
   */
  @Post(':eri/slots/:slotId/submit')
  submitKyc(
    @CurrentGuest() guest: GuestJwtPayload,
    @Param('eri') eri: string,
    @Param('slotId') slotId: string,
    @Body() dto: SubmitKycDto,
  ) {
    return this.kycService.submitKyc(guest.guest_id, eri, slotId, dto);
  }
}
