-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Add colive.price_manage permission to owner and manager roles
--
-- Context: The new admin endpoint PATCH /admin/room-types/:id/colive-price
-- lets owner and manager set the monthly colive price per room type.
-- Reception and other roles must NOT have access to pricing configuration.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE "admin_roles"
SET "permissions" = ("permissions"::jsonb || '["colive.price_manage"]'::jsonb)::json
WHERE "id" IN ('role-owner', 'role-manager');
