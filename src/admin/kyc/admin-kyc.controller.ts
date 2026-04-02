import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { AdminKycService } from './admin-kyc.service';
import { TestOcrDto } from './dto/test-ocr.dto';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import type { AdminJwtPayload } from '../../common/guards/admin-jwt.strategy';

@Controller('admin/kyc')
@UseGuards(AdminJwtGuard, PermissionsGuard)
export class AdminKycController {
  constructor(private readonly adminKycService: AdminKycService) {}

  /**
   * GET /admin/kyc/submissions
   * List all guests with their bookings, slots, and KYC details.
   * Grouped: guest → bookings → slots → kyc.
   * Scoped to admin's property (owners see all).
   */
  @Get('submissions')
  @RequirePermission('kyc.view')
  listAllKycs(@CurrentAdmin() admin: AdminJwtPayload) {
    return this.adminKycService.listAllKycs(admin.property_id ?? null);
  }

  /**
   * GET /admin/kyc/submissions/:slotId/documents
   * Get presigned S3 download/preview URLs for a slot's KYC images.
   * URLs expire in 15 minutes.
   */
  @Get('submissions/:slotId/documents')
  @RequirePermission('kyc.view')
  getDocumentUrls(
    @Param('slotId') slotId: string,
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    return this.adminKycService.getDocumentUrls(slotId, admin.property_id ?? null);
  }

  /**
   * DELETE /admin/kyc/submissions/:slotId/documents/:imageType
   * Delete a KYC document image from S3 and clear the DB reference.
   * imageType: "front" | "back"
   */
  @Delete('submissions/:slotId/documents/:imageType')
  @RequirePermission('kyc.delete')
  deleteDocument(
    @Param('slotId') slotId: string,
    @Param('imageType') imageType: string,
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    if (imageType !== 'front' && imageType !== 'back') {
      throw new Error('imageType must be "front" or "back"');
    }
    return this.adminKycService.deleteDocument(
      slotId,
      imageType as 'front' | 'back',
      admin.property_id ?? null,
    );
  }

  /**
   * POST /admin/kyc/test-ocr
   * Admin OCR test — accepts 1-2 base64 images, returns structured extraction.
   * Nothing is stored.
   */
  @Post('test-ocr')
  testOcr(@Body() dto: TestOcrDto) {
    return this.adminKycService.testOcr(
      dto.front_image_base64,
      dto.back_image_base64,
    );
  }
}
