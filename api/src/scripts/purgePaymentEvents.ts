/**
 * Purge PaymentEvents: retain mode = by age; erase mode = by userId (for future admin).
 * Run: npx tsx src/scripts/purgePaymentEvents.ts [retain|erase] [userId for erase]
 */
import "dotenv/config";
import { fileURLToPath } from "node:url";
import { config } from "../config/index.js";
import { prisma } from "../lib/prisma.js";

const retentionDays = config.PAYMENT_EVENT_RETENTION_DAYS;
const mode = config.PAYMENT_EVENT_RETENTION_MODE;

export async function purgeByUserId(userId: string): Promise<number> {
  const orderIds = await prisma.order.findMany({
    where: { userId },
    select: { id: true },
  });
  const ids = orderIds.map((o) => o.id);
  if (ids.length === 0) return 0;
  const result = await prisma.paymentEvent.deleteMany({
    where: { orderId: { in: ids } },
  });
  return result.count;
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (mode === "retain") {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await prisma.paymentEvent.deleteMany({
      where: { receivedAt: { lt: cutoff } },
    });
    console.log(`Purge (retain): deleted ${result.count} PaymentEvent(s) older than ${retentionDays} days`);
  } else if (mode === "erase" && arg) {
    const count = await purgeByUserId(arg);
    console.log(`Purge (erase): deleted ${count} PaymentEvent(s) for user ${arg}`);
  } else {
    console.log("Usage: retain mode runs automatically; erase mode: npx tsx src/scripts/purgePaymentEvents.ts erase <userId>");
  }
}

const isMainModule =
  typeof process.argv[1] === "string" &&
  process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
