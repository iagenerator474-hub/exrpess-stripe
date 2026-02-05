-- DropForeignKey (was ON DELETE CASCADE)
ALTER TABLE "PaymentEvent" DROP CONSTRAINT IF EXISTS "PaymentEvent_order_id_fkey";

-- AddForeignKey (audit-proof: keep PaymentEvent when Order is deleted)
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
