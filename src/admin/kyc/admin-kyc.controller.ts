import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { AdminKycService } from './admin-kyc.service';
import { TestOcrDto } from './dto/test-ocr.dto';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';

@Controller('admin/kyc')
@UseGuards(AdminJwtGuard)
export class AdminKycController {
  constructor(private readonly adminKycService: AdminKycService) {}

  /**
   * POST /admin/kyc/test-ocr
   * Admin-only OCR test endpoint.
   * Accepts 1-2 base64 images, runs Textract AnalyzeID, returns results.
   * Nothing is stored — images are passed directly as bytes.
   */
  @Post('test-ocr')
  testOcr(@Body() dto: TestOcrDto) {
    return this.adminKycService.testOcr(
      dto.front_image_base64,
      dto.back_image_base64,
    );
  }
}
