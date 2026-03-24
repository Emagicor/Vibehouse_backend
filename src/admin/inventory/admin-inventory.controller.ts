import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminInventoryService } from './admin-inventory.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { RestockDto } from './dto/restock.dto';
import { DamageDto } from './dto/damage.dto';
import { UpdateStockDto } from './dto/update-stock.dto';
import { BorrowableCheckoutDto } from './dto/borrowable-checkout.dto';
import { ReturnableIssueDto } from './dto/returnable-issue.dto';
import { ReturnableReturnDto } from './dto/returnable-return.dto';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import type { AdminJwtPayload } from '../../common/guards/admin-jwt.strategy';

@Controller('admin/inventory')
@UseGuards(AdminJwtGuard, PermissionsGuard)
export class AdminInventoryController {
  constructor(private readonly inventoryService: AdminInventoryService) {}

  // ──── PRODUCT CATALOG ─────────────────────────────────────────────────────

  @Post('products')
  @RequirePermission('inventory.edit')
  createProduct(
    @Body() dto: CreateProductDto,
    @CurrentAdmin() actor: AdminJwtPayload,
  ) {
    return this.inventoryService.createProduct(dto, actor);
  }

  @Get('products')
  @RequirePermission('inventory.view')
  listProducts(@CurrentAdmin() actor: AdminJwtPayload) {
    return this.inventoryService.listProducts(actor.property_id);
  }

  @Get('products/:id')
  @RequirePermission('inventory.view')
  getProduct(@Param('id') id: string) {
    return this.inventoryService.getProduct(id);
  }

  @Patch('products/:id')
  @RequirePermission('inventory.edit')
  updateProduct(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @CurrentAdmin() actor: AdminJwtPayload,
  ) {
    return this.inventoryService.updateProduct(id, dto, actor);
  }

  @Delete('products/:id')
  @RequirePermission('inventory.edit')
  deleteProduct(
    @Param('id') id: string,
    @CurrentAdmin() actor: AdminJwtPayload,
  ) {
    return this.inventoryService.deleteProduct(id, actor);
  }

  // ──── STOCK MANAGEMENT ────────────────────────────────────────────────────

  @Get('stock')
  @RequirePermission('inventory.view')
  listStock(@CurrentAdmin() actor: AdminJwtPayload) {
    return this.inventoryService.listStock(actor.property_id);
  }

  @Post('stock/:productId/restock')
  @RequirePermission('inventory.edit')
  restock(
    @Param('productId') productId: string,
    @Body() dto: RestockDto,
    @CurrentAdmin() actor: AdminJwtPayload,
  ) {
    return this.inventoryService.restock(productId, dto, actor);
  }

  @Post('stock/:productId/damage')
  @RequirePermission('inventory.edit')
  markDamaged(
    @Param('productId') productId: string,
    @Body() dto: DamageDto,
    @CurrentAdmin() actor: AdminJwtPayload,
  ) {
    return this.inventoryService.markDamaged(productId, dto, actor);
  }

  @Patch('stock/:id')
  @RequirePermission('inventory.edit')
  updateStock(
    @Param('id') id: string,
    @Body() dto: UpdateStockDto,
    @CurrentAdmin() actor: AdminJwtPayload,
  ) {
    return this.inventoryService.updateStock(id, dto, actor);
  }

  // ──── BORROWABLE TRACKING ─────────────────────────────────────────────────

  @Get('borrowables')
  @RequirePermission('borrowable.manage')
  listBorrowableInventory(@CurrentAdmin() actor: AdminJwtPayload) {
    return this.inventoryService.listBorrowableInventory(actor.property_id);
  }

  @Get('borrowables/checkouts')
  @RequirePermission('borrowable.manage')
  listActiveCheckouts(@CurrentAdmin() actor: AdminJwtPayload) {
    return this.inventoryService.listActiveCheckouts(actor.property_id);
  }

  @Get('borrowables/guests')
  @RequirePermission('borrowable.manage')
  searchActiveGuests(
    @Query('q') query: string,
    @CurrentAdmin() actor: AdminJwtPayload,
  ) {
    return this.inventoryService.searchActiveGuests(query || '', actor.property_id);
  }

  @Post('borrowables/:productId/checkout')
  @RequirePermission('borrowable.manage')
  borrowableCheckout(
    @Param('productId') productId: string,
    @Body() dto: BorrowableCheckoutDto,
    @CurrentAdmin() actor: AdminJwtPayload,
  ) {
    return this.inventoryService.borrowableCheckout(productId, dto, actor);
  }

  @Post('borrowables/:id/verify-return')
  @RequirePermission('borrowable.return_verify')
  verifyReturn(
    @Param('id') id: string,
    @Body('staff_id') staffId: string,
    @CurrentAdmin() actor: AdminJwtPayload,
  ) {
    return this.inventoryService.verifyReturn(id, staffId || actor.admin_id, actor);
  }

  // ──── RETURNABLE TRACKING ───────────────────────────────────────────────

  @Get('returnables')
  @RequirePermission('returnable.manage')
  listReturnableInventory(@CurrentAdmin() actor: AdminJwtPayload) {
    return this.inventoryService.listReturnableInventory(actor);
  }

  @Get('returnables/forecast/:productId')
  @RequirePermission('returnable.manage')
  getReturnableForecast(
    @Param('productId') productId: string,
    @Query('days') days: string,
    @CurrentAdmin() actor: AdminJwtPayload,
  ) {
    return this.inventoryService.getReturnableForecast(productId, Math.min(Number(days) || 7, 14), actor);
  }

  @Get('returnables/entitlements/:eri')
  @RequirePermission('returnable.manage')
  getReturnableEntitlements(@Param('eri') eri: string) {
    return this.inventoryService.getReturnableEntitlements(eri);
  }

  @Post('returnables/:productId/issue')
  @RequirePermission('returnable.manage')
  returnableIssue(
    @Param('productId') productId: string,
    @Body() dto: ReturnableIssueDto,
    @CurrentAdmin() actor: AdminJwtPayload,
  ) {
    return this.inventoryService.returnableIssue(productId, dto, actor);
  }

  @Post('returnables/:checkoutId/return')
  @RequirePermission('returnable.return_verify')
  returnableVerifyReturn(
    @Param('checkoutId') checkoutId: string,
    @Body() dto: ReturnableReturnDto,
    @CurrentAdmin() actor: AdminJwtPayload,
  ) {
    return this.inventoryService.returnableVerifyReturn(checkoutId, dto, actor);
  }
}
