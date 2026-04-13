-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: Rename property IDs from prop-* format to eZee hotel codes
--
-- Deletes prop-bandra-001 (dev placeholder) and prop-koramangala-b (no eZee
-- code yet). Renames prop-koramangala-a → 60765 (its eZee hotel code).
--
-- Delete order respects all FK constraints discovered from pg_constraint:
--   returnable_checkouts → addon_order_items
--   addon_order_items    → addon_orders
--   zoho_ticket_ref      → addon_orders
--   kyc_submissions      → booking_slots
--   inventory            → product_catalog
--   colive_room_options  → room_types
--   colive_draft_bookings → room_types
-- ═══════════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════════════════════════════════════════════════
-- 0. MOVE shared products from Bandra to KA
--    product_catalog rows have property_id = 'prop-bandra-001' but are
--    referenced by inventory rows for ALL three properties. Reassign them
--    to KA before deleting Bandra so KA/KB inventory FKs remain valid.
-- ══════════════════════════════════════════════════════════════════════════════

UPDATE "product_catalog"
   SET "property_id" = 'prop-koramangala-a'
 WHERE "property_id" = 'prop-bandra-001';


-- ══════════════════════════════════════════════════════════════════════════════
-- 1. DELETE prop-bandra-001 (dev placeholder) — deepest children first
-- ══════════════════════════════════════════════════════════════════════════════

-- 1a. Deepest grandchildren first (respect FK deps within booking children)
-- returnable_checkouts.addon_order_item_id → addon_order_items.id
DELETE FROM "returnable_checkouts"
 WHERE "ezee_reservation_id" IN (
   SELECT "ezee_reservation_id" FROM "ezee_booking_cache" WHERE "property_id" = 'prop-bandra-001'
 );

-- zoho_ticket_ref.addon_order_id → addon_orders.id  (delete before addon_orders)
DELETE FROM "zoho_ticket_ref"
 WHERE "ezee_reservation_id" IN (
   SELECT "ezee_reservation_id" FROM "ezee_booking_cache" WHERE "property_id" = 'prop-bandra-001'
 );

-- addon_order_items.addon_order_id → addon_orders.id
DELETE FROM "addon_order_items"
 WHERE "addon_order_id" IN (
   SELECT "id" FROM "addon_orders"
    WHERE "ezee_reservation_id" IN (
      SELECT "ezee_reservation_id" FROM "ezee_booking_cache" WHERE "property_id" = 'prop-bandra-001'
    )
 );

DELETE FROM "addon_orders"
 WHERE "ezee_reservation_id" IN (
   SELECT "ezee_reservation_id" FROM "ezee_booking_cache" WHERE "property_id" = 'prop-bandra-001'
 );

DELETE FROM "booking_guest_access"
 WHERE "ezee_reservation_id" IN (
   SELECT "ezee_reservation_id" FROM "ezee_booking_cache" WHERE "property_id" = 'prop-bandra-001'
 );

-- kyc_submissions.slot_id → booking_slots.id  (delete before booking_slots)
DELETE FROM "kyc_submissions"
 WHERE "ezee_reservation_id" IN (
   SELECT "ezee_reservation_id" FROM "ezee_booking_cache" WHERE "property_id" = 'prop-bandra-001'
 );

DELETE FROM "booking_slots"
 WHERE "ezee_reservation_id" IN (
   SELECT "ezee_reservation_id" FROM "ezee_booking_cache" WHERE "property_id" = 'prop-bandra-001'
 );

DELETE FROM "borrowable_checkouts"
 WHERE "ezee_reservation_id" IN (
   SELECT "ezee_reservation_id" FROM "ezee_booking_cache" WHERE "property_id" = 'prop-bandra-001'
 );

DELETE FROM "checkin_records"
 WHERE "ezee_reservation_id" IN (
   SELECT "ezee_reservation_id" FROM "ezee_booking_cache" WHERE "property_id" = 'prop-bandra-001'
 );

DELETE FROM "smart_lock_access"
 WHERE "ezee_reservation_id" IN (
   SELECT "ezee_reservation_id" FROM "ezee_booking_cache" WHERE "property_id" = 'prop-bandra-001'
 );

DELETE FROM "stay_extensions"
 WHERE "ezee_reservation_id" IN (
   SELECT "ezee_reservation_id" FROM "ezee_booking_cache" WHERE "property_id" = 'prop-bandra-001'
 );

DELETE FROM "payments"
 WHERE "ezee_reservation_id" IN (
   SELECT "ezee_reservation_id" FROM "ezee_booking_cache" WHERE "property_id" = 'prop-bandra-001'
 );

-- 1b. Direct children of properties
-- colive tables that reference room_types must come before room_types
DELETE FROM "colive_draft_bookings"   WHERE "property_id" = 'prop-bandra-001';
DELETE FROM "colive_quotes"           WHERE "property_id" = 'prop-bandra-001';
DELETE FROM "colive_room_options"     WHERE "property_id" = 'prop-bandra-001';
DELETE FROM "colive_addons"           WHERE "property_id" = 'prop-bandra-001';
DELETE FROM "colive_property_content" WHERE "property_id" = 'prop-bandra-001';

DELETE FROM "ezee_booking_cache"      WHERE "property_id" = 'prop-bandra-001';
DELETE FROM "room_types"              WHERE "property_id" = 'prop-bandra-001';

-- inventory.product_id → product_catalog.id  (delete inventory before product_catalog)
DELETE FROM "inventory"               WHERE "property_id" = 'prop-bandra-001';
DELETE FROM "product_catalog"         WHERE "property_id" = 'prop-bandra-001';
DELETE FROM "events"                  WHERE "property_id" = 'prop-bandra-001';
DELETE FROM "admin_users"             WHERE "property_id" = 'prop-bandra-001';
DELETE FROM "ezee_connection"         WHERE "property_id" = 'prop-bandra-001';
DELETE FROM "mygate_connection"       WHERE "property_id" = 'prop-bandra-001';
DELETE FROM "mygate_devices"          WHERE "property_id" = 'prop-bandra-001';
DELETE FROM "sla_config"              WHERE "property_id" = 'prop-bandra-001';

-- 1c. Parent
DELETE FROM "properties" WHERE "id" = 'prop-bandra-001';


-- ══════════════════════════════════════════════════════════════════════════════
-- 2. DELETE prop-koramangala-b (no eZee code yet) — same safe order
-- ══════════════════════════════════════════════════════════════════════════════

DELETE FROM "returnable_checkouts"
 WHERE "ezee_reservation_id" IN (
   SELECT "ezee_reservation_id" FROM "ezee_booking_cache" WHERE "property_id" = 'prop-koramangala-b'
 );

DELETE FROM "zoho_ticket_ref"
 WHERE "ezee_reservation_id" IN (
   SELECT "ezee_reservation_id" FROM "ezee_booking_cache" WHERE "property_id" = 'prop-koramangala-b'
 );

DELETE FROM "addon_order_items"
 WHERE "addon_order_id" IN (
   SELECT "id" FROM "addon_orders"
    WHERE "ezee_reservation_id" IN (
      SELECT "ezee_reservation_id" FROM "ezee_booking_cache" WHERE "property_id" = 'prop-koramangala-b'
    )
 );

DELETE FROM "addon_orders"
 WHERE "ezee_reservation_id" IN (
   SELECT "ezee_reservation_id" FROM "ezee_booking_cache" WHERE "property_id" = 'prop-koramangala-b'
 );

DELETE FROM "booking_guest_access"
 WHERE "ezee_reservation_id" IN (
   SELECT "ezee_reservation_id" FROM "ezee_booking_cache" WHERE "property_id" = 'prop-koramangala-b'
 );

DELETE FROM "kyc_submissions"
 WHERE "ezee_reservation_id" IN (
   SELECT "ezee_reservation_id" FROM "ezee_booking_cache" WHERE "property_id" = 'prop-koramangala-b'
 );

DELETE FROM "booking_slots"
 WHERE "ezee_reservation_id" IN (
   SELECT "ezee_reservation_id" FROM "ezee_booking_cache" WHERE "property_id" = 'prop-koramangala-b'
 );

DELETE FROM "borrowable_checkouts"
 WHERE "ezee_reservation_id" IN (
   SELECT "ezee_reservation_id" FROM "ezee_booking_cache" WHERE "property_id" = 'prop-koramangala-b'
 );

DELETE FROM "checkin_records"
 WHERE "ezee_reservation_id" IN (
   SELECT "ezee_reservation_id" FROM "ezee_booking_cache" WHERE "property_id" = 'prop-koramangala-b'
 );

DELETE FROM "smart_lock_access"
 WHERE "ezee_reservation_id" IN (
   SELECT "ezee_reservation_id" FROM "ezee_booking_cache" WHERE "property_id" = 'prop-koramangala-b'
 );

DELETE FROM "stay_extensions"
 WHERE "ezee_reservation_id" IN (
   SELECT "ezee_reservation_id" FROM "ezee_booking_cache" WHERE "property_id" = 'prop-koramangala-b'
 );

DELETE FROM "payments"
 WHERE "ezee_reservation_id" IN (
   SELECT "ezee_reservation_id" FROM "ezee_booking_cache" WHERE "property_id" = 'prop-koramangala-b'
 );

DELETE FROM "colive_draft_bookings"   WHERE "property_id" = 'prop-koramangala-b';
DELETE FROM "colive_quotes"           WHERE "property_id" = 'prop-koramangala-b';
DELETE FROM "colive_room_options"     WHERE "property_id" = 'prop-koramangala-b';
DELETE FROM "colive_addons"           WHERE "property_id" = 'prop-koramangala-b';
DELETE FROM "colive_property_content" WHERE "property_id" = 'prop-koramangala-b';

DELETE FROM "ezee_booking_cache"      WHERE "property_id" = 'prop-koramangala-b';
DELETE FROM "room_types"              WHERE "property_id" = 'prop-koramangala-b';
DELETE FROM "inventory"               WHERE "property_id" = 'prop-koramangala-b';
DELETE FROM "product_catalog"         WHERE "property_id" = 'prop-koramangala-b';
DELETE FROM "events"                  WHERE "property_id" = 'prop-koramangala-b';
DELETE FROM "admin_users"             WHERE "property_id" = 'prop-koramangala-b';
DELETE FROM "ezee_connection"         WHERE "property_id" = 'prop-koramangala-b';
DELETE FROM "mygate_connection"       WHERE "property_id" = 'prop-koramangala-b';
DELETE FROM "mygate_devices"          WHERE "property_id" = 'prop-koramangala-b';
DELETE FROM "sla_config"              WHERE "property_id" = 'prop-koramangala-b';

DELETE FROM "properties" WHERE "id" = 'prop-koramangala-b';


-- ══════════════════════════════════════════════════════════════════════════════
-- 3. DROP all 15 FK constraints referencing properties.id
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE "admin_users"             DROP CONSTRAINT "admin_users_property_id_fkey";
ALTER TABLE "room_types"              DROP CONSTRAINT "room_types_property_id_fkey";
ALTER TABLE "events"                  DROP CONSTRAINT "events_property_id_fkey";
ALTER TABLE "ezee_connection"         DROP CONSTRAINT "ezee_connection_property_id_fkey";
ALTER TABLE "ezee_booking_cache"      DROP CONSTRAINT "ezee_booking_cache_property_id_fkey";
ALTER TABLE "inventory"               DROP CONSTRAINT "inventory_property_id_fkey";
ALTER TABLE "mygate_connection"       DROP CONSTRAINT "mygate_connection_property_id_fkey";
ALTER TABLE "mygate_devices"          DROP CONSTRAINT "mygate_devices_property_id_fkey";
ALTER TABLE "product_catalog"         DROP CONSTRAINT "product_catalog_property_id_fkey";
ALTER TABLE "sla_config"              DROP CONSTRAINT "sla_config_property_id_fkey";
ALTER TABLE "colive_property_content" DROP CONSTRAINT "colive_property_content_property_id_fkey";
ALTER TABLE "colive_room_options"     DROP CONSTRAINT "colive_room_options_property_id_fkey";
ALTER TABLE "colive_addons"           DROP CONSTRAINT "colive_addons_property_id_fkey";
ALTER TABLE "colive_quotes"           DROP CONSTRAINT "colive_quotes_property_id_fkey";
ALTER TABLE "colive_draft_bookings"   DROP CONSTRAINT "colive_draft_bookings_property_id_fkey";


-- ══════════════════════════════════════════════════════════════════════════════
-- 4. RENAME prop-koramangala-a → 60765 (eZee hotel code)
-- ══════════════════════════════════════════════════════════════════════════════

UPDATE "properties"              SET "id"          = '60765' WHERE "id"          = 'prop-koramangala-a';
UPDATE "admin_users"             SET "property_id" = '60765' WHERE "property_id" = 'prop-koramangala-a';
UPDATE "room_types"              SET "property_id" = '60765' WHERE "property_id" = 'prop-koramangala-a';
UPDATE "events"                  SET "property_id" = '60765' WHERE "property_id" = 'prop-koramangala-a';
UPDATE "ezee_connection"         SET "property_id" = '60765' WHERE "property_id" = 'prop-koramangala-a';
UPDATE "ezee_booking_cache"      SET "property_id" = '60765' WHERE "property_id" = 'prop-koramangala-a';
UPDATE "inventory"               SET "property_id" = '60765' WHERE "property_id" = 'prop-koramangala-a';
UPDATE "mygate_connection"       SET "property_id" = '60765' WHERE "property_id" = 'prop-koramangala-a';
UPDATE "mygate_devices"          SET "property_id" = '60765' WHERE "property_id" = 'prop-koramangala-a';
UPDATE "product_catalog"         SET "property_id" = '60765' WHERE "property_id" = 'prop-koramangala-a';
UPDATE "sla_config"              SET "property_id" = '60765' WHERE "property_id" = 'prop-koramangala-a';
UPDATE "colive_property_content" SET "property_id" = '60765' WHERE "property_id" = 'prop-koramangala-a';
UPDATE "colive_room_options"     SET "property_id" = '60765' WHERE "property_id" = 'prop-koramangala-a';
UPDATE "colive_addons"           SET "property_id" = '60765' WHERE "property_id" = 'prop-koramangala-a';
UPDATE "colive_quotes"           SET "property_id" = '60765' WHERE "property_id" = 'prop-koramangala-a';
UPDATE "colive_draft_bookings"   SET "property_id" = '60765' WHERE "property_id" = 'prop-koramangala-a';


-- ══════════════════════════════════════════════════════════════════════════════
-- 5. RE-CREATE all 15 FK constraints
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE "admin_users"             ADD CONSTRAINT "admin_users_property_id_fkey"             FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "room_types"              ADD CONSTRAINT "room_types_property_id_fkey"              FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "events"                  ADD CONSTRAINT "events_property_id_fkey"                  FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "ezee_connection"         ADD CONSTRAINT "ezee_connection_property_id_fkey"         FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "ezee_booking_cache"      ADD CONSTRAINT "ezee_booking_cache_property_id_fkey"      FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "inventory"               ADD CONSTRAINT "inventory_property_id_fkey"               FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "mygate_connection"       ADD CONSTRAINT "mygate_connection_property_id_fkey"       FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "mygate_devices"          ADD CONSTRAINT "mygate_devices_property_id_fkey"          FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "product_catalog"         ADD CONSTRAINT "product_catalog_property_id_fkey"         FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "sla_config"              ADD CONSTRAINT "sla_config_property_id_fkey"              FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "colive_property_content" ADD CONSTRAINT "colive_property_content_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "colive_room_options"     ADD CONSTRAINT "colive_room_options_property_id_fkey"     FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "colive_addons"           ADD CONSTRAINT "colive_addons_property_id_fkey"           FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "colive_quotes"           ADD CONSTRAINT "colive_quotes_property_id_fkey"           FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "colive_draft_bookings"   ADD CONSTRAINT "colive_draft_bookings_property_id_fkey"   FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
