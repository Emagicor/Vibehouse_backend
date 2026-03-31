import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';

/**
 * Typed wrapper around NestJS Cache Manager.
 *
 * Centralises key naming, TTLs, and provides a `invalidateByPrefix`
 * helper that uses Redis SCAN to delete keys matching a pattern.
 *
 * All TTLs are in milliseconds.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  // ── TTL constants (ms) ───────────────────────────────────────────────
  static readonly TTL_CATALOG           = 10 * 60 * 1000;  // 10 min
  static readonly TTL_JWT               = 60 * 1000;       // 60 sec
  static readonly TTL_ROOM_AVAILABILITY = 30 * 60 * 1000;  // 30 min

  // Using 'any' type for cache manager to avoid TS1272 with emitDecoratorMetadata
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(@Inject(CACHE_MANAGER) private readonly cache: any) {}

  // ── Core operations ──────────────────────────────────────────────────

  async get<T>(key: string): Promise<T | undefined> {
    try {
      const val = await this.cache.get(key) as T | undefined | null;
      if (val !== undefined && val !== null) {
        this.logger.debug(`Cache HIT: ${key}`);
      }
      return val ?? undefined;
    } catch (err) {
      this.logger.warn(`Cache GET failed for ${key}: ${(err as Error).message}`);
      return undefined;
    }
  }

  async set(key: string, value: unknown, ttlMs?: number): Promise<void> {
    try {
      await this.cache.set(key, value, ttlMs);
      this.logger.debug(`Cache SET: ${key} (TTL: ${ttlMs ?? 'default'}ms)`);
    } catch (err) {
      this.logger.warn(`Cache SET failed for ${key}: ${(err as Error).message}`);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.cache.del(key);
      this.logger.debug(`Cache DEL: ${key}`);
    } catch (err) {
      this.logger.warn(`Cache DEL failed for ${key}: ${(err as Error).message}`);
    }
  }

  // ── Convenience: invalidate all keys for a property ──────────────────

  /**
   * Delete all catalog/stock cache keys for a given property.
   * Called after any product or inventory mutation.
   */
  async invalidatePropertyCache(propertyId: string): Promise<void> {
    const keys = [
      `catalog:${propertyId}`,
      `services:${propertyId}`,
      `borrowables:${propertyId}`,
      `admin:products:${propertyId}`,
      `admin:stock:${propertyId}`,
    ];
    await Promise.all(keys.map((k) => this.del(k)));
    this.logger.log(`Invalidated all cache keys for property: ${propertyId}`);
  }

  /**
   * Delete the JWT validation cache for an admin user.
   * Called after deactivation or deletion.
   */
  async invalidateAdminJwt(adminId: string): Promise<void> {
    await this.del(`jwt:admin:${adminId}`);
  }

  /**
   * Delete the JWT validation cache for a guest.
   */
  async invalidateGuestJwt(guestId: string): Promise<void> {
    await this.del(`jwt:guest:${guestId}`);
  }

  // ── Key builders (so callers don't hardcode strings) ─────────────────

  static catalogKey(propertyId: string): string {
    return `catalog:${propertyId}`;
  }

  static servicesKey(propertyId: string): string {
    return `services:${propertyId}`;
  }

  static borrowablesKey(propertyId: string): string {
    return `borrowables:${propertyId}`;
  }

  static adminProductsKey(propertyId: string): string {
    return `admin:products:${propertyId}`;
  }

  static adminStockKey(propertyId: string): string {
    return `admin:stock:${propertyId}`;
  }

  static adminJwtKey(adminId: string): string {
    return `jwt:admin:${adminId}`;
  }

  static guestJwtKey(guestId: string): string {
    return `jwt:guest:${guestId}`;
  }

  static roomAvailabilityKey(propertyId: string, checkin: string, checkout: string): string {
    return `rooms:${propertyId}:${checkin}:${checkout}`;
  }
}
