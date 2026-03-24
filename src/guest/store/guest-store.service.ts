import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../redis/cache.service';
import { GuestJwtPayload } from '../../common/guards/guest-jwt.strategy';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { RequestBorrowableDto } from './dto/request-borrowable.dto';
import { RequestServiceDto } from './dto/request-service.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class GuestStoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  // ─── HELPERS ──────────────────────────────────────────────────────────────

  /**
   * Verify guest has access to the given ERI (booking) and return the booking.
   */
  private async verifyBookingAccess(guestId: string, eri: string) {
    const access = await this.prisma.booking_guest_access.findFirst({
      where: {
        ezee_reservation_id: eri,
        guest_id: guestId,
        status: 'APPROVED',
      },
      include: {
        ezee_booking_cache: true,
      },
    });

    if (!access) {
      throw new ForbiddenException('You do not have access to this booking');
    }

    return access.ezee_booking_cache;
  }

  /**
   * Check if guest has checked in for this booking.
   */
  private async isCheckedIn(guestId: string, eri: string): Promise<boolean> {
    const record = await this.prisma.checkin_records.findFirst({
      where: {
        ezee_reservation_id: eri,
        guest_id: guestId,
        status: 'COMPLETED',
      },
    });
    return !!record;
  }

  // ─── CATALOG ──────────────────────────────────────────────────────────────

  /**
   * List all purchasable products: COMMODITY + paid SERVICE (Early Check-in, Late Checkout, Laundry, etc.)
   * Guests can browse this without a booking.
   */
  async getCatalog(propertyId: string) {
    // Cache-aside: check cache first
    const cacheKey = CacheService.catalogKey(propertyId);
    const cached = await this.cacheService.get<unknown[]>(cacheKey);
    if (cached) return cached;

    const products = await this.prisma.product_catalog.findMany({
      where: {
        property_id: propertyId,
        is_active: true,
        category: { in: ['COMMODITY', 'SERVICE', 'RETURNABLE'] },
        base_price: { gt: 0 },
      },
      select: {
        id: true,
        name: true,
        description: true,
        category: true,
        base_price: true,
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });

    // Attach stock availability for COMMODITY items
    const commodityIds = products
      .filter((p) => p.category === 'COMMODITY')
      .map((p) => p.id);

    const inventoryRows = commodityIds.length
      ? await this.prisma.inventory.findMany({
          where: { product_id: { in: commodityIds }, property_id: propertyId },
          select: { product_id: true, available_stock: true },
        })
      : [];

    const stockMap = new Map(inventoryRows.map((i) => [i.product_id, i.available_stock]));

    const result = products.map((p) => ({
      ...p,
      base_price: Number(p.base_price),
      in_stock: p.category === 'COMMODITY' ? (stockMap.get(p.id) ?? 0) > 0 : true,
      available_stock: p.category === 'COMMODITY' ? stockMap.get(p.id) ?? 0 : null,
    }));

    // Write to cache
    await this.cacheService.set(cacheKey, result, CacheService.TTL_CATALOG);
    return result;
  }

  /**
   * List free in-house services (only available post-check-in).
   * Room Cleaning, Linen Change, Maintenance, etc.
   */
  async getFreeServices(propertyId: string) {
    // Cache-aside: check cache first
    const cacheKey = CacheService.servicesKey(propertyId);
    const cached = await this.cacheService.get<unknown[]>(cacheKey);
    if (cached) return cached;

    const result = await this.prisma.product_catalog.findMany({
      where: {
        property_id: propertyId,
        is_active: true,
        category: 'SERVICE',
        base_price: 0,
      },
      select: {
        id: true,
        name: true,
        description: true,
        category: true,
        base_price: true,
      },
      orderBy: { name: 'asc' },
    });

    await this.cacheService.set(cacheKey, result, CacheService.TTL_CATALOG);
    return result;
  }

  /**
   * List borrowable items with availability.
   */
  async getBorrowables(propertyId: string) {
    // Cache-aside: check cache first
    const cacheKey = CacheService.borrowablesKey(propertyId);
    const cached = await this.cacheService.get<unknown[]>(cacheKey);
    if (cached) return cached;

    const products = await this.prisma.product_catalog.findMany({
      where: {
        property_id: propertyId,
        is_active: true,
        category: 'BORROWABLE',
      },
      select: {
        id: true,
        name: true,
        description: true,
        inventory: {
          where: { property_id: propertyId },
          select: { available_stock: true, total_stock: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    const result = products.map((p) => {
      const inv = p.inventory[0];
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        available: inv?.available_stock ?? 0,
        total: inv?.total_stock ?? 0,
      };
    });

    await this.cacheService.set(cacheKey, result, CacheService.TTL_CATALOG);
    return result;
  }

  // ─── CART ─────────────────────────────────────────────────────────────────

  /**
   * Get or create a PENDING addon_order for this booking (acts as cart).
   */
  private async getOrCreateCart(guestId: string, eri: string) {
    let order = await this.prisma.addon_orders.findFirst({
      where: {
        ezee_reservation_id: eri,
        guest_id: guestId,
        status: 'PENDING',
      },
    });

    if (!order) {
      order = await this.prisma.addon_orders.create({
        data: {
          id: uuidv4(),
          ezee_reservation_id: eri,
          guest_id: guestId,
          phase: 'PRE_ARRIVAL',
          status: 'PENDING',
        },
      });
    }

    return order;
  }

  /**
   * Add an item to the cart. Only COMMODITY + paid SERVICE allowed.
   */
  async addToCart(guest: GuestJwtPayload, eri: string, dto: AddToCartDto) {
    const booking = await this.verifyBookingAccess(guest.guest_id, eri);

    // Determine phase
    const checkedIn = await this.isCheckedIn(guest.guest_id, eri);
    const phase = checkedIn ? 'DURING_STAY' : 'PRE_ARRIVAL';

    // Validate product
    const product = await this.prisma.product_catalog.findFirst({
      where: {
        id: dto.product_id,
        property_id: booking.property_id,
        is_active: true,
      },
    });

    if (!product) throw new NotFoundException('Product not found');
    if (product.category === 'BORROWABLE')
      throw new BadRequestException('Borrowable items cannot be added to cart. Use the borrow endpoint instead.');
    if (Number(product.base_price) === 0)
      throw new BadRequestException('Free services cannot be added to cart. Use the service request endpoint instead.');

    // Check stock for COMMODITY
    if (product.category === 'COMMODITY') {
      const inventory = await this.prisma.inventory.findFirst({
        where: { product_id: product.id, property_id: booking.property_id },
      });
      if (!inventory || inventory.available_stock < dto.quantity) {
        throw new BadRequestException(
          `Insufficient stock. Available: ${inventory?.available_stock ?? 0}`,
        );
      }
    }

    // Get or create cart
    const cart = await this.getOrCreateCart(guest.guest_id, eri);

    // Update phase if changed
    if (cart.phase !== phase) {
      await this.prisma.addon_orders.update({
        where: { id: cart.id },
        data: { phase },
      });
    }

    // Check if same product + same bed already in cart — if so, increment quantity
    const existingItem = await this.prisma.addon_order_items.findFirst({
      where: {
        addon_order_id: cart.id,
        product_id: dto.product_id,
        unit_code: dto.unit_code,
      },
    });

    const unitPrice = Number(product.base_price);

    if (existingItem) {
      const newQty = existingItem.quantity + dto.quantity;
      await this.prisma.addon_order_items.update({
        where: { id: existingItem.id },
        data: {
          quantity: newQty,
          total_price: unitPrice * newQty,
        },
      });
    } else {
      await this.prisma.addon_order_items.create({
        data: {
          id: uuidv4(),
          addon_order_id: cart.id,
          product_id: dto.product_id,
          quantity: dto.quantity,
          unit_price: unitPrice,
          total_price: unitPrice * dto.quantity,
          unit_code: dto.unit_code,
        },
      });
    }

    return this.getCartDetails(guest.guest_id, eri);
  }

  /**
   * Get full cart with items.
   */
  async getCart(guest: GuestJwtPayload, eri: string) {
    await this.verifyBookingAccess(guest.guest_id, eri);
    return this.getCartDetails(guest.guest_id, eri);
  }

  private async getCartDetails(guestId: string, eri: string) {
    const cart = await this.prisma.addon_orders.findFirst({
      where: {
        ezee_reservation_id: eri,
        guest_id: guestId,
        status: 'PENDING',
      },
      include: {
        addon_order_items: {
          include: {
            product_catalog: {
              select: { name: true, category: true, description: true },
            },
          },
        },
      },
    });

    if (!cart) {
      return { items: [], total: 0, order_id: null };
    }

    const items = cart.addon_order_items.map((item) => ({
      id: item.id,
      product_id: item.product_id,
      name: item.product_catalog.name,
      category: item.product_catalog.category,
      unit_code: item.unit_code,
      quantity: item.quantity,
      unit_price: Number(item.unit_price),
      total_price: Number(item.total_price),
    }));

    const total = items.reduce((sum, i) => sum + i.total_price, 0);

    return { order_id: cart.id, phase: cart.phase, items, total };
  }

  /**
   * Update quantity of a cart item.
   */
  async updateCartItem(
    guest: GuestJwtPayload,
    eri: string,
    itemId: string,
    dto: UpdateCartItemDto,
  ) {
    await this.verifyBookingAccess(guest.guest_id, eri);

    const item = await this.prisma.addon_order_items.findUnique({
      where: { id: itemId },
      include: {
        addon_orders: true,
        product_catalog: true,
      },
    });

    if (!item) throw new NotFoundException('Cart item not found');
    if (item.addon_orders.guest_id !== guest.guest_id)
      throw new ForbiddenException('Not your cart');
    if (item.addon_orders.status !== 'PENDING')
      throw new BadRequestException('Cart already checked out');

    // Stock check for commodity
    if (item.product_catalog.category === 'COMMODITY') {
      const inv = await this.prisma.inventory.findFirst({
        where: { product_id: item.product_id },
      });
      if (inv && inv.available_stock < dto.quantity) {
        throw new BadRequestException(`Insufficient stock. Available: ${inv.available_stock}`);
      }
    }

    await this.prisma.addon_order_items.update({
      where: { id: itemId },
      data: {
        quantity: dto.quantity,
        total_price: Number(item.unit_price) * dto.quantity,
      },
    });

    return this.getCartDetails(guest.guest_id, eri);
  }

  /**
   * Remove an item from the cart.
   */
  async removeCartItem(guest: GuestJwtPayload, eri: string, itemId: string) {
    await this.verifyBookingAccess(guest.guest_id, eri);

    const item = await this.prisma.addon_order_items.findUnique({
      where: { id: itemId },
      include: { addon_orders: true },
    });

    if (!item) throw new NotFoundException('Cart item not found');
    if (item.addon_orders.guest_id !== guest.guest_id)
      throw new ForbiddenException('Not your cart');
    if (item.addon_orders.status !== 'PENDING')
      throw new BadRequestException('Cart already checked out');

    await this.prisma.addon_order_items.delete({ where: { id: itemId } });

    return this.getCartDetails(guest.guest_id, eri);
  }

  // ─── CHECKOUT / PAY ───────────────────────────────────────────────────────

  /**
   * Returns cart summary for checkout. Actual payment is handled by PaymentModule:
   *   POST /payment/create-order  → creates Razorpay order
   *   POST /payment/verify        → verifies payment after Razorpay checkout
   *   POST /webhook/razorpay      → webhook backup
   *   POST /payment/dev/simulate-capture → local dev testing
   */
  async checkout(guest: GuestJwtPayload, eri: string) {
    await this.verifyBookingAccess(guest.guest_id, eri);

    const cart = await this.prisma.addon_orders.findFirst({
      where: {
        ezee_reservation_id: eri,
        guest_id: guest.guest_id,
        status: 'PENDING',
      },
      include: {
        addon_order_items: {
          include: { product_catalog: true },
        },
      },
    });

    if (!cart || cart.addon_order_items.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    const total = cart.addon_order_items.reduce(
      (sum, i) => sum + Number(i.total_price),
      0,
    );

    return {
      message: 'Cart ready for payment. Call POST /payment/create-order to proceed.',
      order_id: cart.id,
      ezee_reservation_id: eri,
      total,
      items: cart.addon_order_items.map((i) => ({
        id: i.id,
        product: i.product_catalog.name,
        category: i.product_catalog.category,
        quantity: i.quantity,
        unit_price: Number(i.unit_price),
        total_price: Number(i.total_price),
      })),
      next_step: 'POST /payment/create-order { "ezee_reservation_id": "' + eri + '" }',
    };
  }

  // ─── BORROWABLE REQUEST ───────────────────────────────────────────────────

  /**
   * Guest requests a borrowable item. Creates a borrowable_checkouts row.
   * Only allowed post-booking.
   */
  async requestBorrowable(
    guest: GuestJwtPayload,
    eri: string,
    dto: RequestBorrowableDto,
  ) {
    const booking = await this.verifyBookingAccess(guest.guest_id, eri);

    const product = await this.prisma.product_catalog.findFirst({
      where: {
        id: dto.product_id,
        property_id: booking.property_id,
        is_active: true,
        category: 'BORROWABLE',
      },
    });

    if (!product) throw new NotFoundException('Borrowable item not found');

    const inventory = await this.prisma.inventory.findFirst({
      where: { product_id: product.id, property_id: booking.property_id },
    });

    if (!inventory || inventory.available_stock <= 0) {
      throw new BadRequestException(`"${product.name}" is currently unavailable`);
    }

    // Check if guest already has this item checked out for this booking
    const existingCheckout = await this.prisma.borrowable_checkouts.findFirst({
      where: {
        guest_id: guest.guest_id,
        ezee_reservation_id: eri,
        inventory_id: inventory.id,
        status: 'CHECKED_OUT',
      },
    });

    if (existingCheckout) {
      throw new BadRequestException(`You already have a "${product.name}" checked out`);
    }

    // Create checkout record
    const checkoutId = uuidv4();
    const checkout = await this.prisma.borrowable_checkouts.create({
      data: {
        id: checkoutId,
        inventory_id: inventory.id,
        ezee_reservation_id: eri,
        guest_id: guest.guest_id,
        unit_code: booking.unit_code ?? 'N/A',
        status: 'CHECKED_OUT',
      },
    });

    // Decrement available stock
    await this.prisma.inventory.update({
      where: { id: inventory.id },
      data: {
        available_stock: { decrement: 1 },
        borrowed_out_count: { increment: 1 },
      },
    });

    // Invalidate borrowable cache
    await this.cacheService.invalidatePropertyCache(booking.property_id);

    return {
      message: `"${product.name}" has been checked out to you`,
      checkout_id: checkout.id,
      product_name: product.name,
      expected_duration_hours: dto.expected_duration_hours ?? null,
    };
  }

  /**
   * List guest's active borrowable checkouts for a booking.
   */
  async getMyBorrowables(guest: GuestJwtPayload, eri: string) {
    await this.verifyBookingAccess(guest.guest_id, eri);

    const checkouts = await this.prisma.borrowable_checkouts.findMany({
      where: {
        guest_id: guest.guest_id,
        ezee_reservation_id: eri,
      },
      include: {
        inventory: {
          include: {
            product_catalog: {
              select: { name: true, description: true },
            },
          },
        },
      },
      orderBy: { checked_out_at: 'desc' },
    });

    return checkouts.map((c) => ({
      id: c.id,
      product_name: c.inventory.product_catalog.name,
      status: c.status,
      checked_out_at: c.checked_out_at,
      returned_at: c.returned_at,
    }));
  }

  // ─── FREE SERVICE REQUEST ────────────────────────────────────────────────

  /**
   * Request a free in-house service (room cleaning, linen change, etc.)
   * Only allowed post-check-in. Creates a zoho_ticket_ref as a service request.
   */
  async requestFreeService(
    guest: GuestJwtPayload,
    eri: string,
    dto: RequestServiceDto,
  ) {
    const booking = await this.verifyBookingAccess(guest.guest_id, eri);

    // Verify guest has checked in
    const checkedIn = await this.isCheckedIn(guest.guest_id, eri);
    if (!checkedIn) {
      throw new BadRequestException(
        'In-house services are only available after check-in',
      );
    }

    const product = await this.prisma.product_catalog.findFirst({
      where: {
        id: dto.product_id,
        property_id: booking.property_id,
        is_active: true,
        category: 'SERVICE',
        base_price: 0,
      },
    });

    if (!product) throw new NotFoundException('Service not found');

    // Create a zoho_ticket_ref as the service request record
    const ticketId = uuidv4();
    const ticket = await this.prisma.zoho_ticket_ref.create({
      data: {
        id: ticketId,
        ezee_reservation_id: eri,
        guest_id: guest.guest_id,
        zoho_ticket_id: `SVC-${ticketId.slice(0, 8)}`,
        ticket_type: 'SERVICE_REQUEST',
        department: 'OPERATIONS',
        room_number: booking.room_number,
        unit_code: booking.unit_code,
        status: 'OPEN',
        synced_at: new Date(),
      },
    });

    return {
      message: `"${product.name}" request submitted`,
      ticket_id: ticket.id,
      service_name: product.name,
      notes: dto.notes ?? null,
    };
  }

  // ─── ORDER HISTORY ────────────────────────────────────────────────────────

  /**
   * Get all orders for a booking (both PENDING cart and PAID orders).
   */
  async getOrders(guest: GuestJwtPayload, eri: string) {
    await this.verifyBookingAccess(guest.guest_id, eri);

    const orders = await this.prisma.addon_orders.findMany({
      where: {
        ezee_reservation_id: eri,
        guest_id: guest.guest_id,
      },
      include: {
        addon_order_items: {
          include: {
            product_catalog: {
              select: { name: true, category: true },
            },
          },
        },
        payments: {
          select: { status: true, amount: true, created_at: true },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    return orders.map((o) => ({
      id: o.id,
      status: o.status,
      phase: o.phase,
      created_at: o.created_at,
      payment: o.payments
        ? { status: o.payments.status, amount: Number(o.payments.amount) }
        : null,
      items: o.addon_order_items.map((i) => ({
        name: i.product_catalog.name,
        category: i.product_catalog.category,
        quantity: i.quantity,
        unit_price: Number(i.unit_price),
        total_price: Number(i.total_price),
      })),
      total: o.addon_order_items.reduce((s, i) => s + Number(i.total_price), 0),
    }));
  }

  // ─── MY RETURNABLES ───────────────────────────────────────────────────────

  /**
   * Returns the guest's returnable item entitlements for a booking:
   * what they paid for (RETURNABLE items in PAID orders) + issuance status.
   */
  async getMyReturnables(guestId: string, eri: string) {
    await this.verifyBookingAccess(guestId, eri);

    // Get all PAID addon_order_items for RETURNABLE products on this booking
    const orders = await this.prisma.addon_orders.findMany({
      where: { ezee_reservation_id: eri, guest_id: guestId, status: 'PAID' },
      include: {
        addon_order_items: {
          include: { product_catalog: true },
          where: { product_catalog: { category: 'RETURNABLE' } },
        },
      },
    });

    const items = orders.flatMap((o) => o.addon_order_items);
    if (items.length === 0) return [];

    // Get issuance records
    const itemIds = items.map((i) => i.id);
    const checkouts = await this.prisma.returnable_checkouts.findMany({
      where: { addon_order_item_id: { in: itemIds } },
    });

    return items.map((item) => {
      const issued = checkouts.filter((c) => c.addon_order_item_id === item.id);
      const issuedQty = issued.reduce((s, c) => s + c.quantity, 0);
      const activeCheckouts = issued.filter((c) => c.status === 'ISSUED');
      return {
        addon_order_item_id: item.id,
        product_id: item.product_id,
        product_name: item.product_catalog.name,
        ordered_quantity: item.quantity,
        issued_quantity: issuedQty,
        pending_quantity: item.quantity - issuedQty,
        active_checkouts: activeCheckouts.map((c) => ({
          id: c.id,
          quantity: c.quantity,
          issued_at: c.issued_at,
          status: c.status,
        })),
      };
    });
  }
}
