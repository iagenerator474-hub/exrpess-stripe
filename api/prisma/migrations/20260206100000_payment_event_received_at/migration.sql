-- RenameColumn: processedAt -> receivedAt (semantic: when event was persisted, not "processed")
ALTER TABLE "PaymentEvent" RENAME COLUMN "processed_at" TO "received_at";
