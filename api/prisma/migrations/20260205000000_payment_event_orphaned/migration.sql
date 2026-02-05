-- AlterTable
ALTER TABLE "payment_event" ADD COLUMN "orphaned" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: make order_id nullable so we can store events when order is missing
ALTER TABLE "payment_event" ALTER COLUMN "order_id" DROP NOT NULL;
