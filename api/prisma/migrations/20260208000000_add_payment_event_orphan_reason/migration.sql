-- AlterTable
ALTER TABLE "payment_event" ADD COLUMN IF NOT EXISTS "orphan_reason" TEXT;
