import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { config } from "../../config/index.js";

const router = Router();

router.get("/health", async (_req, res) => {
  let dbStatus: "up" | "down" = "down";
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = "up";
  } catch {
  }
  const ok = dbStatus === "up";
  const body: Record<string, unknown> = {
    status: ok ? "ok" : "degraded",
    db: dbStatus,
  };
  if (config.HEALTH_EXPOSE_ENV) {
    body.env = config.NODE_ENV;
  }
  res.status(ok ? 200 : 503).json(body);
});

router.get("/ready", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    await prisma.product.count();
    res.status(200).json({ status: "ready" });
  } catch {
    res.status(503).json({ status: "not ready" });
  }
});

export const healthRoutes = router;
