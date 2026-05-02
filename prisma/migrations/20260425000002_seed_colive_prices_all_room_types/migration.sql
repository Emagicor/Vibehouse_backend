-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: Seed colive_price_month for all 5 TDS Koramangala room types
--
-- Context: Migration 20260423000001 only set colive_price_month on rt-ka-4dorm
-- and rt-ka-deluxe. The three colive-only room types (4-bed female, 6-bed mixed,
-- 6-bed female) had no rows in room_types at all — they were omitted from the
-- 20260422 seed because they lack eZee rate plans and aren't bookable for nightly.
-- For colive they ARE used, so they need room_types rows + colive_price_month.
--
-- Confirmed eZee nightly rates (from eZee rate sheet, 2026-04-29):
--   4 Bed Mixed      → ₹599/night  (base_price_per_night)
--   4 Bed Female     → ₹499/night  (base_price_per_night; colive extra-days fallback)
--   6 Bed Mixed      → ₹499/night  (base_price_per_night; colive extra-days fallback)
--   6 Bed Female     → ₹459/night  (base_price_per_night; colive extra-days fallback)
--   Deluxe           → ₹1,899/night (base_price_per_night)
--
-- Colive monthly prices (confirmed business rates):
--   4 Bed (mixed + female)   → ₹14,999/month
--   6 Bed (mixed + female)   → ₹12,999/month
--   Deluxe                   → ₹55,999/month  (already set in 20260423000001)
--
-- is_active = false keeps them hidden from nightly booking (no eZee rate plan);
-- colive_room_options references them independently.
-- ═══════════════════════════════════════════════════════════════════════════════

-- Insert the 3 colive-only room types that have no existing row
INSERT INTO "room_types" (
  "id", "property_id", "name", "slug", "type",
  "total_rooms", "beds_per_room", "total_beds",
  "base_price_per_night", "floor_range", "amenities",
  "ezee_room_type_id", "ezee_rate_plan_id", "ezee_rate_type_id",
  "colive_price_month", "is_active"
) VALUES
  (
    'rt-ka-4dorm-female', '60765', '4 Bed Dormitory Female', '4-bed-female-dorm', 'DORM',
    4, 4, 16,
    499, '1',
    '["AC","Shared Bathroom","WiFi","Personal Locker","Reading Light","Female Only"]'::jsonb,
    '6076500000000000005', NULL, NULL,
    14999, false
  ),
  (
    'rt-ka-6dorm', '60765', '6 Bed Mixed Dormitory', '6-bed-mixed-dorm', 'DORM',
    4, 6, 24,
    499, '2-5',
    '["AC","Shared Bathroom","WiFi","Personal Locker","Reading Light"]'::jsonb,
    '6076500000000000004', NULL, NULL,
    12999, false
  ),
  (
    'rt-ka-6dorm-female', '60765', '6 Bed Dormitory Female', '6-bed-female-dorm', 'DORM',
    1, 6, 6,
    459, '1',
    '["AC","Shared Bathroom","WiFi","Personal Locker","Reading Light","Female Only"]'::jsonb,
    '6076500000000000006', NULL, NULL,
    12999, false
  )
ON CONFLICT ("id") DO UPDATE SET
  "base_price_per_night" = EXCLUDED."base_price_per_night",
  "total_rooms"          = EXCLUDED."total_rooms",
  "total_beds"           = EXCLUDED."total_beds",
  "floor_range"          = EXCLUDED."floor_range",
  "colive_price_month"   = EXCLUDED."colive_price_month";

-- Ensure existing rows have correct colive prices and confirmed base rates
UPDATE "room_types" SET "colive_price_month" = 14999, "base_price_per_night" = 599  WHERE "id" = 'rt-ka-4dorm';
UPDATE "room_types" SET "colive_price_month" = 55999, "base_price_per_night" = 1899 WHERE "id" = 'rt-ka-deluxe';
