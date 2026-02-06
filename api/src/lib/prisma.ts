import { PrismaClient } from "@prisma/client";
import { config } from "../config/index.js";
import { logger } from "./logger.js";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      config.NODE_ENV === "development"
        ? [{ emit: "event", level: "query" }, { emit: "stdout", level: "error" }]
        : [{ emit: "stdout", level: "error" }],
  });

if (config.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  prisma.$on("query" as never, (e: { query: string; duration: number }) => {
    logger.debug("Prisma query", { query: e.query, duration: e.duration });
  });
}
