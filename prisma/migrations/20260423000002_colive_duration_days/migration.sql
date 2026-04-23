-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Replace duration_months with duration_days in colive tables
--
-- Context: Colive quotes now accept a day-level duration (minimum 30) instead
-- of whole months. Formula: floor(days/30) × monthly_price + remainder × nightly.
--
-- These tables are empty in production (colive feature not yet live), so the
-- column rename is safe with no data loss.
--
-- colive_search_sessions keeps duration_months — the search/browse UX continues
-- to display durations in months; only the quote/draft flow uses days.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "colive_quotes" RENAME COLUMN "duration_months" TO "duration_days";
ALTER TABLE "colive_draft_bookings" RENAME COLUMN "duration_months" TO "duration_days";
