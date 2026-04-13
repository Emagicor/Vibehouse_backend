-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: Deactivate legacy (pre-prefix) room type IDs
--
-- After the property ID rename (migration 20260413000000), property 60765
-- ended up with two overlapping sets of room types:
--
--   Legacy (from base seed, pre-TDS):  rt-queen, rt-4dorm, rt-6dorm
--   Current (from seed-tds.ts):        rt-ka-queen, rt-ka-4dorm, rt-ka-6dorm
--
-- Both sets share the same slugs (queen-size-room, 4-bed-mixed-dorm,
-- 6-bed-mixed-dorm), causing duplicate rows in the room catalog API and
-- duplicate React keys on the frontend.
--
-- Fix: mark the three legacy IDs is_active = false.
-- The rt-ka-* types are the canonical live room types.
--
-- These legacy types also lack ezee_room_type_id / ezee_rate_plan_id /
-- ezee_rate_type_id so they cannot be booked against eZee anyway.
-- ═══════════════════════════════════════════════════════════════════════════════

UPDATE "room_types"
   SET "is_active" = false
 WHERE "id" IN ('rt-queen', 'rt-4dorm', 'rt-6dorm');
