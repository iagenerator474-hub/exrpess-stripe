/**
 * Purge PaymentEvents: retain = by age; erase = by userId (admin only).
 * Usage:
 *   retain: npx tsx src/scripts/purgePaymentEvents.ts [retain]
 *   erase:  PURGE_CONFIRM=YES npx tsx src/scripts/purgePaymentEvents.ts erase <userId>
 * In erase mode, PURGE_CONFIRM=YES is required (freelance-safe).
 */
import "dotenv/config";
import { fileURLToPath } from "node:url";
import { config } from "../config/index.js";
import { prisma } from "../lib/prisma.js";

const retentionDays = config.PAYMENT_EVENT_RETENTION_DAYS;
const configMode = config.PAYMENT_EVENT_RETENTION_MODE;

export type PurgeMode = "retain" | "erase";

export interface ParseArgsResult {
  mode: PurgeMode;
  userId: string | undefined;
}

/**
 * Parse CLI args: argv[2] = optional action ("retain" | "erase"), argv[3] = userId (required when mode is erase).
 * Final mode: argv[2] overrides config when "retain" or "erase", else use config default.
 */
export function parseArgs(argv: string[], defaultMode: PurgeMode = configMode): ParseArgsResult {
  const action = argv[2];
  const userId = argv[3];
  const mode: PurgeMode =
    action === "retain" || action === "erase" ? action : defaultMode;
  return {
    mode,
    userId: mode === "erase" ? (userId ?? undefined) : undefined,
  };
}

/** In erase mode, script must only run when PURGE_CONFIRM === "YES" (freelance-safe). */
export function isEraseAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PURGE_CONFIRM === "YES";
}

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

function printUsage(): void {
  console.log(
    "Usage: npx tsx src/scripts/purgePaymentEvents.ts [retain|erase] [userId]\n" +
      "  retain: purge events older than PAYMENT_EVENT_RETENTION_DAYS (default)\n" +
      "  erase:  purge events for one user (requires userId); set PURGE_CONFIRM=YES to confirm"
  );
}

async function main(): Promise<void> {
  const { mode, userId } = parseArgs(process.argv);

  if (mode === "retain") {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await prisma.paymentEvent.deleteMany({
      where: { receivedAt: { lt: cutoff } },
    });
    console.log(
      `Purge (retain): deleted ${result.count} PaymentEvent(s) older than ${retentionDays} days`
    );
    return;
  }

  if (mode === "erase") {
    if (!isEraseAllowed()) {
      console.error(
        "Erase mode requires PURGE_CONFIRM=YES. Set it in the environment to confirm."
      );
      process.exit(1);
    }
    if (!userId || userId.trim() === "") {
      console.error("Erase mode requires a userId as third argument.");
      printUsage();
      process.exit(1);
    }
    const count = await purgeByUserId(userId.trim());
    console.log(`Purge (erase): deleted ${count} PaymentEvent(s) for user ${userId}`);
    return;
  }

  printUsage();
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
