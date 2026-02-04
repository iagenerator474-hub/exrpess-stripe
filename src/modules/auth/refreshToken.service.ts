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

export async function rotate(tokenValue: string): Promise<RotateResult> {
  const record = await findValid(tokenValue);
  if (!record) {
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
  const newToken = await prisma.refreshToken.create({
    data: {
      userId: record.userId,
      tokenHash: newHash,
      expiresAt: newExp,
    },
  });
  await prisma.refreshToken.update({
    where: { id: record.id },
    data: { revokedAt: new Date(), replacedByTokenId: newToken.id },
  });
  const accessToken = generateAccessToken({
    sub: user.id,
    email: user.email,
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
