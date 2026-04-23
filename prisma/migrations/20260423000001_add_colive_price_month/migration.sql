-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Add colive_price_month to room_types
--
-- Context: Colive pricing is switching from a nightly-rate × 30 model to a
-- fixed monthly colive price. This field stores the negotiated monthly price
-- (pre-GST) for each room type when booked as a long-stay / colive unit.
-- Managed by owner/manager via the admin panel.
--
-- NULL = colive pricing not configured for this room type (quote will error).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "room_types" ADD COLUMN "colive_price_month" DECIMAL(10,2) NULL;

-- Seed initial colive prices for The Daily Social Koramangala (property 60765)
UPDATE "room_types" SET "colive_price_month" = 14999 WHERE "id" = 'rt-ka-4dorm';
UPDATE "room_types" SET "colive_price_month" = 55999 WHERE "id" = 'rt-ka-deluxe';
