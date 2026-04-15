-- Migration: inventory_non_negative_constraints
-- Purpose: Prevent available_stock and related fields from going negative.
--          First cleans up any existing negative values (from the borrowable
--          race condition bug), then adds CHECK constraints as a permanent
--          defensive layer. Any future code bug that tries to decrement below 0
--          will now throw a PostgreSQL constraint violation instead of silently
--          corrupting data.

-- Step 1: Clean up existing negative values (idempotent — safe to run on live data)
UPDATE "inventory" SET "available_stock"    = 0 WHERE "available_stock"    < 0;
UPDATE "inventory" SET "reserved_stock"     = 0 WHERE "reserved_stock"     < 0;
UPDATE "inventory" SET "borrowed_out_count" = 0 WHERE "borrowed_out_count" < 0;
UPDATE "inventory" SET "sold_count"         = 0 WHERE "sold_count"         < 0;
UPDATE "inventory" SET "damaged_count"      = 0 WHERE "damaged_count"      < 0;

-- Step 2: Add CHECK constraints
ALTER TABLE "inventory"
  ADD CONSTRAINT "inventory_available_stock_non_negative"    CHECK ("available_stock"    >= 0),
  ADD CONSTRAINT "inventory_reserved_stock_non_negative"     CHECK ("reserved_stock"     >= 0),
  ADD CONSTRAINT "inventory_borrowed_out_count_non_negative" CHECK ("borrowed_out_count" >= 0),
  ADD CONSTRAINT "inventory_sold_count_non_negative"         CHECK ("sold_count"         >= 0),
  ADD CONSTRAINT "inventory_damaged_count_non_negative"      CHECK ("damaged_count"      >= 0);
