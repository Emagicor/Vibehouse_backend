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
import { GuestJwtGuard } from '../../common/guards/guest-jwt.guard';
import { CurrentGuest } from '../../common/decorators/current-guest.decorator';
import type { GuestJwtPayload } from '../../common/guards/guest-jwt.strategy';
import { GuestStoreService } from './guest-store.service';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { RequestBorrowableDto } from './dto/request-borrowable.dto';
import { RequestServiceDto } from './dto/request-service.dto';

@Controller('guest/store')
export class GuestStoreController {
  constructor(private readonly storeService: GuestStoreService) {}

  // ─── CATALOG (public-ish, but property_id needed) ──────────────────────

  /** Browse purchasable products (COMMODITY + paid SERVICE). */
  @Get('catalog')
  getCatalog(@Query('property_id') propertyId: string) {
    return this.storeService.getCatalog(propertyId);
  }

  /** List free in-house services (room cleaning, linen change, etc.) */
  @Get('services')
  getFreeServices(@Query('property_id') propertyId: string) {
    return this.storeService.getFreeServices(propertyId);
  }

  /** List borrowable items with availability. */
  @Get('borrowables')
  getBorrowables(@Query('property_id') propertyId: string) {
    return this.storeService.getBorrowables(propertyId);
  }

  // ─── CART (requires auth + booking access) ────────────────────────────

  /** Get cart contents for a booking. */
  @UseGuards(GuestJwtGuard)
  @Get('cart/:eri')
  getCart(
    @CurrentGuest() guest: GuestJwtPayload,
    @Param('eri') eri: string,
  ) {
    return this.storeService.getCart(guest, eri);
  }

  /** Add item to cart. */
  @UseGuards(GuestJwtGuard)
  @Post('cart/:eri/add')
  addToCart(
    @CurrentGuest() guest: GuestJwtPayload,
    @Param('eri') eri: string,
    @Body() dto: AddToCartDto,
  ) {
    return this.storeService.addToCart(guest, eri, dto);
  }

  /** Update cart item quantity. */
  @UseGuards(GuestJwtGuard)
  @Patch('cart/:eri/item/:itemId')
  updateCartItem(
    @CurrentGuest() guest: GuestJwtPayload,
    @Param('eri') eri: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.storeService.updateCartItem(guest, eri, itemId, dto);
  }

  /** Remove item from cart. */
  @UseGuards(GuestJwtGuard)
  @Delete('cart/:eri/item/:itemId')
  removeCartItem(
    @CurrentGuest() guest: GuestJwtPayload,
    @Param('eri') eri: string,
    @Param('itemId') itemId: string,
  ) {
    return this.storeService.removeCartItem(guest, eri, itemId);
  }

  /** Checkout / Pay — simulated payment. */
  @UseGuards(GuestJwtGuard)
  @Post('cart/:eri/checkout')
  checkout(
    @CurrentGuest() guest: GuestJwtPayload,
    @Param('eri') eri: string,
  ) {
    return this.storeService.checkout(guest, eri);
  }

  // ─── BORROWABLE ───────────────────────────────────────────────────────

  /** Request a borrowable item (optional duration). */
  @UseGuards(GuestJwtGuard)
  @Post(':eri/borrowable/request')
  requestBorrowable(
    @CurrentGuest() guest: GuestJwtPayload,
    @Param('eri') eri: string,
    @Body() dto: RequestBorrowableDto,
  ) {
    return this.storeService.requestBorrowable(guest, eri, dto);
  }

  /** List my active borrowable checkouts for a booking. */
  @UseGuards(GuestJwtGuard)
  @Get(':eri/borrowable/mine')
  getMyBorrowables(
    @CurrentGuest() guest: GuestJwtPayload,
    @Param('eri') eri: string,
  ) {
    return this.storeService.getMyBorrowables(guest, eri);
  }

  // ─── FREE SERVICE REQUEST ────────────────────────────────────────────

  /** Request a free in-house service (post-check-in only). */
  @UseGuards(GuestJwtGuard)
  @Post(':eri/service/request')
  requestFreeService(
    @CurrentGuest() guest: GuestJwtPayload,
    @Param('eri') eri: string,
    @Body() dto: RequestServiceDto,
  ) {
    return this.storeService.requestFreeService(guest, eri, dto);
  }

  // ─── ORDER HISTORY ────────────────────────────────────────────────────

  /** Get all orders for a booking. */
  @UseGuards(GuestJwtGuard)
  @Get(':eri/orders')
  getOrders(
    @CurrentGuest() guest: GuestJwtPayload,
    @Param('eri') eri: string,
  ) {
    return this.storeService.getOrders(guest, eri);
  }
}
