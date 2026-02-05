import { prisma } from "../../lib/prisma.js";
import { config } from "../../config/index.js";
import { AppError } from "../../middleware/errorHandler.js";
import {
  generateAccessToken,
  generateRefreshTokenValue,
  hashRefreshToken,
} from "./token.service.js";

const TTL_DAYS = config.REFRESH_TOKEN_TTL_DAYS;

function expiresAt(): Date {
  const d = new Date();
  d.setDate(d.getDate() + TTL_DAYS);
  return d;
}

export interface CreateResult {
  refreshTokenValue: string;
  expiresAt: Date;
}

export async function create(userId: string): Promise<CreateResult> {
  const value = generateRefreshTokenValue();
  const tokenHash = hashRefreshToken(value);
  const exp = expiresAt();
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt: exp,
    },
  });
  return { refreshTokenValue: value, expiresAt: exp };
}

export interface ValidTokenRecord {
  id: string;
  userId: string;
}

export async function findValid(tokenValue: string): Promise<ValidTokenRecord | null> {
  const tokenHash = hashRefreshToken(tokenValue);
  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, revokedAt: true, expiresAt: true },
  });
  if (!record || record.revokedAt || record.expiresAt < new Date()) {
    return null;
  }
  return { id: record.id, userId: record.userId };
}

export async function revokeByTokenValue(tokenValue: string): Promise<void> {
  const tokenHash = hashRefreshToken(tokenValue);
  await prisma.refreshToken.updateMany({
    where: { tokenHash },
    data: { revokedAt: new Date() },
  });
}

export async function revokeById(id: string): Promise<void> {
  await prisma.refreshToken.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
}

export interface RotateResult {
  accessToken: string;
  user: { id: string; email: string; role: string };
  newRefreshTokenValue: string;
  newExpiresAt: Date;
}

/** Rotate refresh token. Single-use: consume token in transaction (replacedByTokenId null) so double-use returns 401. */
export async function rotate(tokenValue: string): Promise<RotateResult> {
  const tokenHash = hashRefreshToken(tokenValue);
  const now = new Date();

  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, revokedAt: true, replacedByTokenId: true, expiresAt: true },
  });
  if (!record || record.revokedAt || record.replacedByTokenId || record.expiresAt < now) {
    throw new AppError("Invalid or expired refresh token", 401, "UNAUTHORIZED");
  }

  const user = await prisma.user.findUnique({
    where: { id: record.userId },
    select: { id: true, email: true, role: true },
  });
  if (!user) {
    throw new AppError("User not found", 401, "UNAUTHORIZED");
  }

  const newValue = generateRefreshTokenValue();
  const newHash = hashRefreshToken(newValue);
  const newExp = expiresAt();

  const consumed = await prisma.$transaction(async (tx) => {
    const updateResult = await tx.refreshToken.updateMany({
      where: {
        id: record.id,
        revokedAt: null,
        replacedByTokenId: null,
        expiresAt: { gt: now },
      },
      data: { revokedAt: now },
    });
    if (updateResult.count === 0) {
      return null;
    }
    const newToken = await tx.refreshToken.create({
      data: {
        userId: record.userId,
        tokenHash: newHash,
        expiresAt: newExp,
      },
    });
    await tx.refreshToken.update({
      where: { id: record.id },
      data: { replacedByTokenId: newToken.id },
    });
    return newToken;
  });

  if (!consumed) {
    throw new AppError("Invalid or expired refresh token", 401, "UNAUTHORIZED");
  }

  const accessToken = generateAccessToken({
    sub: user.id,
    role: user.role,
  });
  return {
    accessToken,
    user: { id: user.id, email: user.email, role: user.role },
    newRefreshTokenValue: newValue,
    newExpiresAt: newExp,
  };
}

export async function revokeAllForUser(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId },
    data: { revokedAt: new Date() },
  });
}
