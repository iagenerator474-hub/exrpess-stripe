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
    // leave dbStatus as "down"
  }
  const ok = dbStatus === "up";
  res.status(ok ? 200 : 503).json({
    status: ok ? "ok" : "degraded",
    env: config.NODE_ENV,
    db: dbStatus,
  });
});

router.get("/ready", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: "ready" });
  } catch {
    res.status(503).json({ status: "not ready" });
  }
});

export const healthRoutes = router;
