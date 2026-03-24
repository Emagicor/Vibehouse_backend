import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../redis/cache.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { RestockDto } from './dto/restock.dto';
import { DamageDto } from './dto/damage.dto';
import { UpdateStockDto } from './dto/update-stock.dto';
import { BorrowableCheckoutDto } from './dto/borrowable-checkout.dto';
import { ReturnableIssueDto } from './dto/returnable-issue.dto';
import { ReturnableReturnDto } from './dto/returnable-return.dto';
import type { AdminJwtPayload } from '../../common/guards/admin-jwt.strategy';

@Injectable()
export class AdminInventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  // ──────────────────────────────────────────────────────────────────────────
  // PRODUCT CATALOG
  // ──────────────────────────────────────────────────────────────────────────

  async createProduct(dto: CreateProductDto, actor: AdminJwtPayload) {
    const propertyId = dto.property_id;

    const property = await this.prisma.properties.findUnique({
      where: { id: propertyId },
    });
    if (!property) throw new NotFoundException('Property not found');

    const id = uuidv4();

    const product = await this.prisma.product_catalog.create({
      data: {
        id,
        property_id: propertyId,
        name: dto.name,
        description: dto.description ?? null,
        category: dto.category,
        base_price: dto.base_price,
      },
    });

    // Auto-create inventory row for COMMODITY / BORROWABLE
    let inventoryRow: Awaited<ReturnType<typeof this.prisma.inventory.create>> | null = null;
    if (dto.category !== 'SERVICE') {
      const stock = dto.initial_stock ?? 0;
      inventoryRow = await this.prisma.inventory.create({
        data: {
          id: uuidv4(),
          property_id: propertyId,
          product_id: id,
          total_stock: stock,
          available_stock: stock,
          low_stock_threshold: dto.low_stock_threshold ?? 5,
        },
      });
    }

    await this.prisma.admin_activity_log.create({
      data: {
        id: uuidv4(),
        actor_type: 'ADMIN',
        actor_id: actor.admin_id,
        action: 'PRODUCT_CREATE',
        entity_type: 'product_catalog',
        entity_id: id,
        new_value: { name: dto.name, category: dto.category },
      },
    });

    // Invalidate cache for this property
    await this.cacheService.invalidatePropertyCache(propertyId);

    return {
      ...this.formatProduct(product),
      inventory: inventoryRow ? this.formatStock(inventoryRow) : null,
    };
  }

  async listProducts(propertyId: string | null) {
    // Cache-aside: check cache first (use 'all' for owner who sees all properties)
    const cachePropertyId = propertyId ?? 'all';
    const cacheKey = CacheService.adminProductsKey(cachePropertyId);
    const cached = await this.cacheService.get<unknown[]>(cacheKey);
    if (cached) return cached;

    const where = propertyId ? { property_id: propertyId } : {};
    const products = await this.prisma.product_catalog.findMany({
      where,
      include: { inventory: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });

    const result = products.map((p) => ({
      ...this.formatProduct(p),
      inventory: p.inventory.length > 0 ? this.formatStock(p.inventory[0]) : null,
    }));

    await this.cacheService.set(cacheKey, result, CacheService.TTL_CATALOG);
    return result;
  }

  async getProduct(id: string) {
    const product = await this.prisma.product_catalog.findUnique({
      where: { id },
      include: { inventory: true },
    });
    if (!product) throw new NotFoundException('Product not found');

    return {
      ...this.formatProduct(product),
      inventory: product.inventory.length > 0 ? this.formatStock(product.inventory[0]) : null,
    };
  }

  async updateProduct(id: string, dto: UpdateProductDto, actor: AdminJwtPayload) {
    const existing = await this.prisma.product_catalog.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Product not found');

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.base_price !== undefined) data.base_price = dto.base_price;
    if (dto.is_active !== undefined) data.is_active = dto.is_active;

    const updated = await this.prisma.product_catalog.update({
      where: { id },
      data,
      include: { inventory: true },
    });

    await this.prisma.admin_activity_log.create({
      data: {
        id: uuidv4(),
        actor_type: 'ADMIN',
        actor_id: actor.admin_id,
        action: 'PRODUCT_UPDATE',
        entity_type: 'product_catalog',
        entity_id: id,
        new_value: dto as object,
      },
    });

    // Invalidate cache
    await this.cacheService.invalidatePropertyCache(existing.property_id);
    // Also invalidate 'all' key for owner view
    await this.cacheService.invalidatePropertyCache('all');

    return {
      ...this.formatProduct(updated),
      inventory: updated.inventory.length > 0 ? this.formatStock(updated.inventory[0]) : null,
    };
  }

  async deleteProduct(id: string, actor: AdminJwtPayload) {
    const product = await this.prisma.product_catalog.findUnique({
      where: { id },
      include: { addon_order_items: { take: 1 } },
    });
    if (!product) throw new NotFoundException('Product not found');

    if (product.addon_order_items.length > 0) {
      throw new ConflictException(
        'Cannot delete a product with existing orders. Deactivate it instead (set is_active=false).',
      );
    }

    // Delete inventory rows first (child FK)
    await this.prisma.inventory.deleteMany({ where: { product_id: id } });
    await this.prisma.product_catalog.delete({ where: { id } });

    await this.prisma.admin_activity_log.create({
      data: {
        id: uuidv4(),
        actor_type: 'ADMIN',
        actor_id: actor.admin_id,
        action: 'PRODUCT_DELETE',
        entity_type: 'product_catalog',
        entity_id: id,
        old_value: { name: product.name, category: product.category },
      },
    });

    // Invalidate cache
    await this.cacheService.invalidatePropertyCache(product.property_id);
    await this.cacheService.invalidatePropertyCache('all');

    return { message: 'Product deleted successfully' };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STOCK MANAGEMENT
  // ──────────────────────────────────────────────────────────────────────────

  async listStock(propertyId: string | null) {
    // Cache-aside: check cache first
    const cachePropertyId = propertyId ?? 'all';
    const cacheKey = CacheService.adminStockKey(cachePropertyId);
    const cached = await this.cacheService.get<unknown[]>(cacheKey);
    if (cached) return cached;

    const where = propertyId ? { property_id: propertyId } : {};
    const rows = await this.prisma.inventory.findMany({
      where,
      include: { product_catalog: true },
      orderBy: { product_catalog: { name: 'asc' } },
    });

    const result = rows.map((r) => ({
      ...this.formatStock(r),
      product: this.formatProduct(r.product_catalog),
    }));

    await this.cacheService.set(cacheKey, result, CacheService.TTL_CATALOG);
    return result;
  }

  async restock(productId: string, dto: RestockDto, actor: AdminJwtPayload) {
    const where: Record<string, string> = { product_id: productId };
    if (actor.property_id) where.property_id = actor.property_id;

    const inv = await this.prisma.inventory.findFirst({ where });
    if (!inv) throw new NotFoundException('Inventory not found for this product');

    const updated = await this.prisma.inventory.update({
      where: { id: inv.id },
      data: {
        total_stock: { increment: dto.quantity },
        available_stock: { increment: dto.quantity },
        updated_at: new Date(),
      },
      include: { product_catalog: true },
    });

    await this.prisma.admin_activity_log.create({
      data: {
        id: uuidv4(),
        actor_type: 'ADMIN',
        actor_id: actor.admin_id,
        action: 'INVENTORY_RESTOCK',
        entity_type: 'inventory',
        entity_id: inv.id,
        new_value: { quantity_added: dto.quantity, new_total: updated.total_stock },
      },
    });

    // Invalidate cache
    await this.cacheService.invalidatePropertyCache(inv.property_id);
    await this.cacheService.invalidatePropertyCache('all');

    return {
      ...this.formatStock(updated),
      product: this.formatProduct(updated.product_catalog),
    };
  }

  async markDamaged(productId: string, dto: DamageDto, actor: AdminJwtPayload) {
    const where: Record<string, string> = { product_id: productId };
    if (actor.property_id) where.property_id = actor.property_id;

    const inv = await this.prisma.inventory.findFirst({ where });
    if (!inv) throw new NotFoundException('Inventory not found for this product');

    if (inv.available_stock < dto.quantity) {
      throw new BadRequestException(
        `Only ${inv.available_stock} units available — cannot mark ${dto.quantity} as damaged`,
      );
    }

    const updated = await this.prisma.inventory.update({
      where: { id: inv.id },
      data: {
        available_stock: { decrement: dto.quantity },
        total_stock: { decrement: dto.quantity },
        damaged_count: { increment: dto.quantity },
        updated_at: new Date(),
      },
      include: { product_catalog: true },
    });

    await this.prisma.admin_activity_log.create({
      data: {
        id: uuidv4(),
        actor_type: 'ADMIN',
        actor_id: actor.admin_id,
        action: 'INVENTORY_DAMAGE',
        entity_type: 'inventory',
        entity_id: inv.id,
        new_value: {
          damaged_qty: dto.quantity,
          notes: dto.notes,
          new_available: updated.available_stock,
        },
      },
    });

    // Invalidate cache
    await this.cacheService.invalidatePropertyCache(inv.property_id);
    await this.cacheService.invalidatePropertyCache('all');

    return {
      ...this.formatStock(updated),
      product: this.formatProduct(updated.product_catalog),
    };
  }

  async updateStock(inventoryId: string, dto: UpdateStockDto, actor: AdminJwtPayload) {
    const inv = await this.prisma.inventory.findUnique({ where: { id: inventoryId } });
    if (!inv) throw new NotFoundException('Inventory row not found');

    const data: Record<string, unknown> = { updated_at: new Date() };
    if (dto.low_stock_threshold !== undefined) data.low_stock_threshold = dto.low_stock_threshold;

    const updated = await this.prisma.inventory.update({
      where: { id: inventoryId },
      data,
      include: { product_catalog: true },
    });

    await this.prisma.admin_activity_log.create({
      data: {
        id: uuidv4(),
        actor_type: 'ADMIN',
        actor_id: actor.admin_id,
        action: 'INVENTORY_CONFIG_UPDATE',
        entity_type: 'inventory',
        entity_id: inventoryId,
        new_value: dto as object,
      },
    });

    // Invalidate cache
    await this.cacheService.invalidatePropertyCache(inv.property_id);
    await this.cacheService.invalidatePropertyCache('all');

    return {
      ...this.formatStock(updated),
      product: this.formatProduct(updated.product_catalog),
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // BORROWABLE TRACKING
  // ──────────────────────────────────────────────────────────────────────────

  // List borrowable inventory items (the products themselves, with stock)
  async listBorrowableInventory(propertyId: string | null) {
    const where: Record<string, unknown> = {
      product_catalog: { category: 'BORROWABLE' },
    };
    if (propertyId) where.property_id = propertyId;

    const rows = await this.prisma.inventory.findMany({
      where,
      include: {
        product_catalog: true,
        borrowable_checkouts: {
          where: { status: { in: ['CHECKED_OUT', 'OVERDUE'] } },
          include: {
            guests: { select: { id: true, name: true, email: true, phone: true } },
            ezee_booking_cache: {
              select: { ezee_reservation_id: true, room_number: true },
            },
          },
          orderBy: { checked_out_at: 'desc' },
        },
      },
      orderBy: { product_catalog: { name: 'asc' } },
    });

    return rows.map((r) => ({
      ...this.formatStock(r),
      product: this.formatProduct(r.product_catalog),
      active_checkouts: r.borrowable_checkouts.map((c) => ({
        id: c.id,
        status: c.status,
        checked_out_at: c.checked_out_at,
        unit_code: c.unit_code,
        guest: c.guests,
        booking: {
          ezee_reservation_id: c.ezee_booking_cache.ezee_reservation_id,
          room_number: c.ezee_booking_cache.room_number,
        },
      })),
    }));
  }

  // Admin-initiated borrowable checkout (lend item to guest)
  async borrowableCheckout(
    productId: string,
    dto: BorrowableCheckoutDto,
    actor: AdminJwtPayload,
  ) {
    const where: Record<string, string> = { product_id: productId };
    if (actor.property_id) where.property_id = actor.property_id;

    const inv = await this.prisma.inventory.findFirst({
      where,
      include: { product_catalog: true },
    });
    if (!inv) throw new NotFoundException('Inventory not found for this product');
    if (inv.product_catalog.category !== 'BORROWABLE') {
      throw new BadRequestException('Only BORROWABLE items can be checked out');
    }
    if (inv.available_stock < 1) {
      throw new BadRequestException('No available stock to lend');
    }

    // Verify guest exists
    const guest = await this.prisma.guests.findUnique({ where: { id: dto.guest_id } });
    if (!guest) throw new NotFoundException('Guest not found');

    // Verify booking exists
    const booking = await this.prisma.ezee_booking_cache.findUnique({
      where: { ezee_reservation_id: dto.ezee_reservation_id },
    });
    if (!booking) throw new NotFoundException('Booking not found');

    const checkoutId = uuidv4();

    await this.prisma.$transaction([
      this.prisma.borrowable_checkouts.create({
        data: {
          id: checkoutId,
          inventory_id: inv.id,
          ezee_reservation_id: dto.ezee_reservation_id,
          guest_id: dto.guest_id,
          unit_code: inv.product_catalog.name.toUpperCase().replace(/\s+/g, '-'),
          status: 'CHECKED_OUT',
          issued_by_admin_id: actor.admin_id,
        },
      }),
      this.prisma.inventory.update({
        where: { id: inv.id },
        data: {
          available_stock: { decrement: 1 },
          borrowed_out_count: { increment: 1 },
          updated_at: new Date(),
        },
      }),
    ]);

    await this.prisma.admin_activity_log.create({
      data: {
        id: uuidv4(),
        actor_type: 'ADMIN',
        actor_id: actor.admin_id,
        action: 'BORROWABLE_CHECKOUT',
        entity_type: 'borrowable_checkouts',
        entity_id: checkoutId,
        new_value: {
          product: inv.product_catalog.name,
          guest_id: dto.guest_id,
          guest_name: guest.name,
          booking: dto.ezee_reservation_id,
        },
      },
    });

    // Invalidate cache
    await this.cacheService.invalidatePropertyCache(inv.property_id);
    await this.cacheService.invalidatePropertyCache('all');

    return { message: 'Item checked out successfully', checkout_id: checkoutId };
  }

  // Search active guests (those with active bookings) — for the checkout form
  async searchActiveGuests(query: string, propertyId: string | null) {
    const bookingWhere: Record<string, unknown> = { is_active: true };
    if (propertyId) bookingWhere.property_id = propertyId;

    const bookings = await this.prisma.ezee_booking_cache.findMany({
      where: bookingWhere,
      include: {
        booking_guest_access: {
          include: {
            guests_booking_guest_access_guest_idToguests: {
              select: { id: true, name: true, email: true, phone: true },
            },
          },
        },
      },
    });

    // Flatten to unique guests with their booking info
    const guestMap = new Map<string, {
      id: string;
      name: string;
      email: string | null;
      phone: string | null;
      bookings: { ezee_reservation_id: string; room_number: string | null }[];
    }>();

    for (const b of bookings) {
      for (const access of b.booking_guest_access) {
        const g = access.guests_booking_guest_access_guest_idToguests;
        const lowerQuery = query.toLowerCase();
        const matches =
          g.name.toLowerCase().includes(lowerQuery) ||
          (g.email && g.email.toLowerCase().includes(lowerQuery)) ||
          (g.phone && g.phone.includes(query));

        if (!matches) continue;

        const existing = guestMap.get(g.id);
        const booking = {
          ezee_reservation_id: b.ezee_reservation_id,
          room_number: b.room_number,
        };

        if (existing) {
          existing.bookings.push(booking);
        } else {
          guestMap.set(g.id, {
            id: g.id,
            name: g.name,
            email: g.email,
            phone: g.phone,
            bookings: [booking],
          });
        }
      }
    }

    return Array.from(guestMap.values()).slice(0, 10);
  }

  async listActiveCheckouts(propertyId: string | null) {
    const where: Record<string, unknown> = {
      status: { in: ['CHECKED_OUT', 'OVERDUE'] },
    };
    if (propertyId) {
      where.inventory = { property_id: propertyId };
    }

    const rows = await this.prisma.borrowable_checkouts.findMany({
      where,
      include: {
        inventory: { include: { product_catalog: true } },
        guests: { select: { id: true, name: true, email: true, phone: true } },
        ezee_booking_cache: {
          select: { ezee_reservation_id: true, room_number: true },
        },
      },
      orderBy: { checked_out_at: 'desc' },
    });

    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      checked_out_at: r.checked_out_at,
      unit_code: r.unit_code,
      product_name: r.inventory.product_catalog.name,
      guest: r.guests,
      booking: {
        ezee_reservation_id: r.ezee_booking_cache.ezee_reservation_id,
        room_number: r.ezee_booking_cache.room_number,
      },
    }));
  }

  async verifyReturn(checkoutId: string, staffId: string, actor: AdminJwtPayload) {
    const checkout = await this.prisma.borrowable_checkouts.findUnique({
      where: { id: checkoutId },
    });
    if (!checkout) throw new NotFoundException('Borrowable checkout not found');

    if (checkout.status === 'RETURNED') {
      throw new BadRequestException('Item is already returned');
    }

    await this.prisma.$transaction([
      this.prisma.borrowable_checkouts.update({
        where: { id: checkoutId },
        data: {
          status: 'RETURNED',
          returned_at: new Date(),
          returned_verified_by_zoho_staff_id: staffId,
        },
      }),
      this.prisma.inventory.update({
        where: { id: checkout.inventory_id },
        data: {
          available_stock: { increment: 1 },
          borrowed_out_count: { decrement: 1 },
          updated_at: new Date(),
        },
      }),
    ]);

    await this.prisma.admin_activity_log.create({
      data: {
        id: uuidv4(),
        actor_type: 'ADMIN',
        actor_id: actor.admin_id,
        action: 'BORROWABLE_RETURN_VERIFIED',
        entity_type: 'borrowable_checkouts',
        entity_id: checkoutId,
        new_value: { verified_by: staffId },
      },
    });

    // Invalidate cache — need property_id from inventory
    const inv = await this.prisma.inventory.findUnique({
      where: { id: checkout.inventory_id },
      select: { property_id: true },
    });
    if (inv) {
      await this.cacheService.invalidatePropertyCache(inv.property_id);
      await this.cacheService.invalidatePropertyCache('all');
    }

    return { message: 'Return verified successfully' };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // FORMAT HELPERS
  // ──────────────────────────────────────────────────────────────────────────

  private formatProduct(p: {
    id: string;
    property_id: string;
    name: string;
    description: string | null;
    category: string;
    base_price: unknown;
    is_active: boolean;
  }) {
    return {
      id: p.id,
      property_id: p.property_id,
      name: p.name,
      description: p.description,
      category: p.category,
      base_price: Number(p.base_price),
      is_active: p.is_active,
    };
  }

  private formatStock(i: {
    id: string;
    property_id: string;
    product_id: string;
    total_stock: number;
    available_stock: number;
    reserved_stock: number;
    sold_count: number;
    damaged_count: number;
    borrowed_out_count: number;
    low_stock_threshold: number;
    updated_at: Date;
  }) {
    return {
      id: i.id,
      property_id: i.property_id,
      product_id: i.product_id,
      total_stock: i.total_stock,
      available_stock: i.available_stock,
      reserved_stock: i.reserved_stock,
      sold_count: i.sold_count,
      damaged_count: i.damaged_count,
      borrowed_out_count: i.borrowed_out_count,
      low_stock_threshold: i.low_stock_threshold,
      is_low_stock: i.available_stock <= i.low_stock_threshold,
      updated_at: i.updated_at,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RETURNABLE ITEMS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * List all RETURNABLE products with inventory + active checkouts.
   */
  async listReturnableInventory(actor: AdminJwtPayload) {
    const propertyId = actor.property_id ?? 'prop-bandra-001';

    const items = await this.prisma.inventory.findMany({
      where: {
        property_id: propertyId,
        product_catalog: { category: 'RETURNABLE', is_active: true },
      },
      include: {
        product_catalog: true,
        returnable_checkouts: {
          where: { status: 'ISSUED' },
          include: {
            guests: { select: { id: true, name: true, email: true, phone: true } },
            ezee_booking_cache: { select: { ezee_reservation_id: true, room_number: true, room_type_name: true } },
          },
          orderBy: { issued_at: 'desc' },
        },
      },
    });

    return items.map((inv) => ({
      inventory_id: inv.id,
      product_id: inv.product_id,
      product_name: inv.product_catalog.name,
      base_price: Number(inv.product_catalog.base_price),
      total_stock: inv.total_stock,
      available_stock: inv.available_stock,
      borrowed_out_count: inv.borrowed_out_count,
      damaged_count: inv.damaged_count,
      low_stock_threshold: inv.low_stock_threshold,
      is_low_stock: inv.available_stock <= inv.low_stock_threshold,
      active_checkouts: inv.returnable_checkouts.map((c) => ({
        id: c.id,
        guest: c.guests,
        booking: c.ezee_booking_cache,
        quantity: c.quantity,
        unit_code: c.unit_code,
        issued_at: c.issued_at,
        status: c.status,
      })),
    }));
  }

  /**
   * 7-day demand forecast for a specific RETURNABLE product.
   * Shows per-day: new demand (check-ins with this item), expected returns (check-outs),
   * currently issued, and projected availability.
   */
  async getReturnableForecast(productId: string, days: number, actor: AdminJwtPayload) {
    const propertyId = actor.property_id ?? 'prop-bandra-001';

    // Get inventory for this product
    const inv = await this.prisma.inventory.findFirst({
      where: { product_id: productId, property_id: propertyId },
      include: { product_catalog: true },
    });
    if (!inv) throw new Error('Inventory not found');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const forecast: {
      date: string;
      new_demand: number;
      expected_returns: number;
      currently_issued: number;
      projected_available: number;
      status: 'ok' | 'warning' | 'shortage';
    }[] = [];

    // Currently issued count (baseline)
    const currentlyIssued = await this.prisma.returnable_checkouts.count({
      where: { inventory_id: inv.id, status: 'ISSUED' },
    });

    for (let d = 0; d < days; d++) {
      const date = new Date(today);
      date.setDate(date.getDate() + d);
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      // New demand: bookings checking in on this date that have PAID orders for this product
      const newDemandItems = await this.prisma.addon_order_items.findMany({
        where: {
          product_id: productId,
          addon_orders: {
            status: 'PAID',
            ezee_booking_cache: {
              property_id: propertyId,
              checkin_date: { gte: date, lt: nextDate },
            },
          },
        },
      });
      const newDemand = newDemandItems.reduce((sum, i) => sum + i.quantity, 0);

      // Expected returns: bookings checking out on this date that have ISSUED returnable_checkouts for this product
      const returningCheckouts = await this.prisma.returnable_checkouts.findMany({
        where: {
          inventory_id: inv.id,
          status: 'ISSUED',
          ezee_booking_cache: {
            checkout_date: { gte: date, lt: nextDate },
          },
        },
      });
      const expectedReturns = returningCheckouts.reduce((sum, c) => sum + c.quantity, 0);

      // Projected: start with current state, accumulate changes day by day
      // For day 0: projected = available_stock - new_demand + expected_returns
      // For day N: we'd need cumulative, but a simple per-day view is more useful
      const effectiveStock = inv.total_stock - inv.damaged_count;
      const projectedIssued = currentlyIssued + newDemand - expectedReturns;
      const projectedAvailable = effectiveStock - projectedIssued;

      let status: 'ok' | 'warning' | 'shortage' = 'ok';
      if (projectedAvailable <= 0) status = 'shortage';
      else if (projectedAvailable <= inv.low_stock_threshold) status = 'warning';

      forecast.push({
        date: date.toISOString().split('T')[0],
        new_demand: newDemand,
        expected_returns: expectedReturns,
        currently_issued: d === 0 ? currentlyIssued : projectedIssued,
        projected_available: Math.max(0, projectedAvailable),
        status,
      });
    }

    return {
      product_id: productId,
      product_name: inv.product_catalog.name,
      total_stock: inv.total_stock,
      damaged_count: inv.damaged_count,
      effective_stock: inv.total_stock - inv.damaged_count,
      forecast,
    };
  }

  /**
   * Get returnable entitlements for a booking: what RETURNABLE items
   * were paid for, how many have been issued, how many pending.
   */
  async getReturnableEntitlements(eri: string) {
    const orders = await this.prisma.addon_orders.findMany({
      where: { ezee_reservation_id: eri, status: 'PAID' },
      include: {
        addon_order_items: {
          include: { product_catalog: true },
        },
      },
    });

    const returnableItems = orders.flatMap((o) =>
      o.addon_order_items.filter((i) => i.product_catalog.category === 'RETURNABLE'),
    );

    if (returnableItems.length === 0) return [];

    const itemIds = returnableItems.map((i) => i.id);
    const checkouts = await this.prisma.returnable_checkouts.findMany({
      where: { addon_order_item_id: { in: itemIds } },
    });

    return returnableItems.map((item) => {
      const issued = checkouts.filter((c) => c.addon_order_item_id === item.id);
      const issuedQty = issued.reduce((s, c) => s + c.quantity, 0);
      return {
        addon_order_item_id: item.id,
        product_id: item.product_id,
        product_name: item.product_catalog.name,
        ordered_quantity: item.quantity,
        issued_quantity: issuedQty,
        pending_quantity: item.quantity - issuedQty,
        checkouts: issued.map((c) => ({
          id: c.id,
          quantity: c.quantity,
          status: c.status,
          issued_at: c.issued_at,
          returned_at: c.returned_at,
          condition_on_return: c.condition_on_return,
        })),
      };
    });
  }

  /**
   * Issue a returnable item to a guest at check-in.
   * Validates entitlement (guest paid for it) and available stock.
   */
  async returnableIssue(
    productId: string,
    dto: ReturnableIssueDto,
    actor: AdminJwtPayload,
  ) {
    const propertyId = actor.property_id ?? 'prop-bandra-001';
    const quantity = dto.quantity ?? 1;

    // 1. Validate product is RETURNABLE
    const product = await this.prisma.product_catalog.findFirst({
      where: { id: productId, category: 'RETURNABLE', is_active: true },
    });
    if (!product) throw new NotFoundException('Returnable product not found');

    // 2. Validate inventory
    const inventory = await this.prisma.inventory.findFirst({
      where: { product_id: productId, property_id: propertyId },
    });
    if (!inventory) throw new NotFoundException('Inventory not found');
    if (inventory.available_stock < quantity) {
      throw new BadRequestException(
        `Insufficient stock for "${product.name}". Available: ${inventory.available_stock}`,
      );
    }

    // 3. Validate entitlement (guest paid for this item)
    const orderItem = await this.prisma.addon_order_items.findUnique({
      where: { id: dto.addon_order_item_id },
      include: { addon_orders: true },
    });
    if (!orderItem || orderItem.product_id !== productId) {
      throw new BadRequestException('Order item does not match this product');
    }
    if (orderItem.addon_orders.status !== 'PAID') {
      throw new BadRequestException('Order is not paid');
    }
    if (orderItem.addon_orders.guest_id !== dto.guest_id) {
      throw new BadRequestException('Order does not belong to this guest');
    }

    // 4. Check not over-issuing
    const existingCheckouts = await this.prisma.returnable_checkouts.findMany({
      where: { addon_order_item_id: dto.addon_order_item_id },
    });
    const alreadyIssued = existingCheckouts.reduce((s, c) => s + c.quantity, 0);
    if (alreadyIssued + quantity > orderItem.quantity) {
      throw new BadRequestException(
        `Cannot issue ${quantity} — already issued ${alreadyIssued} of ${orderItem.quantity} ordered`,
      );
    }

    // 5. Issue in transaction
    const checkoutId = uuidv4();
    await this.prisma.$transaction([
      this.prisma.returnable_checkouts.create({
        data: {
          id: checkoutId,
          inventory_id: inventory.id,
          addon_order_item_id: dto.addon_order_item_id,
          ezee_reservation_id: dto.ezee_reservation_id,
          guest_id: dto.guest_id,
          unit_code: orderItem.unit_code,
          quantity,
          status: 'ISSUED',
          issued_by_admin_id: actor.admin_id,
        },
      }),
      this.prisma.inventory.update({
        where: { id: inventory.id },
        data: {
          available_stock: { decrement: quantity },
          borrowed_out_count: { increment: quantity },
        },
      }),
      this.prisma.admin_activity_log.create({
        data: {
          id: uuidv4(),
          actor_type: 'ADMIN',
          actor_id: actor.admin_id,
          action: 'RETURNABLE_ISSUED',
          entity_type: 'returnable_checkout',
          entity_id: checkoutId,
          new_value: {
            product: product.name,
            guest_id: dto.guest_id,
            eri: dto.ezee_reservation_id,
            quantity,
          },
        },
      }),
    ]);

    await this.cacheService.invalidatePropertyCache(propertyId);

    return {
      message: `Issued ${quantity}x ${product.name}`,
      checkout_id: checkoutId,
      product: product.name,
      quantity,
      remaining_stock: inventory.available_stock - quantity,
    };
  }

  /**
   * Verify return of a returnable item.
   * GOOD → stock restored. DAMAGED/LOST → stock NOT restored, damaged_count++.
   */
  async returnableVerifyReturn(
    checkoutId: string,
    dto: ReturnableReturnDto,
    actor: AdminJwtPayload,
  ) {
    const checkout = await this.prisma.returnable_checkouts.findUnique({
      where: { id: checkoutId },
      include: { inventory: { include: { product_catalog: true } } },
    });

    if (!checkout) throw new NotFoundException('Returnable checkout not found');
    if (checkout.status !== 'ISSUED') {
      throw new BadRequestException(`Item already ${checkout.status}`);
    }

    const propertyId = checkout.inventory.property_id;
    const newStatus = dto.condition === 'LOST' ? 'LOST' : 'RETURNED';

    const inventoryUpdates: Record<string, any> = {
      borrowed_out_count: { decrement: checkout.quantity },
    };

    if (dto.condition === 'GOOD') {
      // Item returned in good shape → restore to available stock
      inventoryUpdates.available_stock = { increment: checkout.quantity };
    } else {
      // DAMAGED or LOST → unit removed from circulation
      inventoryUpdates.damaged_count = { increment: checkout.quantity };
      inventoryUpdates.total_stock = { decrement: checkout.quantity };
    }

    await this.prisma.$transaction([
      this.prisma.returnable_checkouts.update({
        where: { id: checkoutId },
        data: {
          status: newStatus,
          returned_at: new Date(),
          condition_on_return: dto.condition,
          returned_verified_by_admin_id: actor.admin_id,
          notes: dto.notes ?? null,
        },
      }),
      this.prisma.inventory.update({
        where: { id: checkout.inventory_id },
        data: inventoryUpdates,
      }),
      this.prisma.admin_activity_log.create({
        data: {
          id: uuidv4(),
          actor_type: 'ADMIN',
          actor_id: actor.admin_id,
          action: 'RETURNABLE_RETURN_VERIFIED',
          entity_type: 'returnable_checkout',
          entity_id: checkoutId,
          new_value: {
            product: checkout.inventory.product_catalog.name,
            condition: dto.condition,
            quantity: checkout.quantity,
            notes: dto.notes,
          },
        },
      }),
    ]);

    await this.cacheService.invalidatePropertyCache(propertyId);

    return {
      message: `Return verified (${dto.condition})`,
      checkout_id: checkoutId,
      product: checkout.inventory.product_catalog.name,
      condition: dto.condition,
      status: newStatus,
    };
  }
}
