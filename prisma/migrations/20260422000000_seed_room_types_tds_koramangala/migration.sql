-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: Seed room_types for The Daily Social Koramangala (property 60765)
--
-- Context: the production Aurora database has zero rows in room_types, causing
-- the guest booking page to show Rs. 0 for every room (see
-- docs/blockers/room-pricing-production-data-blocker-2026-04-21.md).
--
-- Only the two room types that have eZee rate plans are seeded here. The three
-- rate-plan-less room types (6-bed mixed dorm, 4-bed female, 6-bed female) are
-- intentionally omitted — they are not bookable online and do not need DB rows.
--
-- Pattern mirrors migration 20260413000001 (pure data migration, no schema
-- changes). Uses ON CONFLICT DO UPDATE so the statement is idempotent.
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO "room_types" (
  "id", "property_id", "name", "slug", "type",
  "total_rooms", "beds_per_room", "total_beds",
  "base_price_per_night", "floor_range", "amenities",
  "ezee_room_type_id", "ezee_rate_plan_id", "ezee_rate_type_id",
  "is_active"
) VALUES
  (
    'rt-ka-4dorm', '60765', '4 Bed Mixed Dormitory', '4-bed-mixed-dorm', 'DORM',
    15, 4, 60,
    500, '1-4',
    '["AC","Shared Bathroom","WiFi","Personal Locker","Reading Light"]'::jsonb,
    '6076500000000000001', '6076500000000000001', '6076500000000000001',
    true
  ),
  (
    'rt-ka-deluxe', '60765', 'Deluxe', 'deluxe', 'PRIVATE',
    14, 1, 14,
    1500, '1-4',
    '["AC","Attached Bathroom","WiFi","Work Desk","Smart Lock"]'::jsonb,
    '6076500000000000002', '6076500000000000001', '6076500000000000001',
    true
  )
ON CONFLICT ("id") DO UPDATE SET
  "ezee_room_type_id"    = EXCLUDED."ezee_room_type_id",
  "ezee_rate_plan_id"    = EXCLUDED."ezee_rate_plan_id",
  "ezee_rate_type_id"    = EXCLUDED."ezee_rate_type_id",
  "base_price_per_night" = EXCLUDED."base_price_per_night",
  "is_active"            = EXCLUDED."is_active";
