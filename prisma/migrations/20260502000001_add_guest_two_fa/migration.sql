-- Migration: Add two_fa_enabled to guests
-- Enables email-OTP based 2FA on guest login.
-- Default false — opt-in per guest.

ALTER TABLE "guests" ADD COLUMN IF NOT EXISTS "two_fa_enabled" BOOLEAN NOT NULL DEFAULT FALSE;
