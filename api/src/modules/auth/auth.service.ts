import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../middleware/errorHandler.js";
import { generateAccessToken } from "./token.service.js";
import * as refreshTokenService from "./refreshToken.service.js";

const SALT_ROUNDS = 10;

export interface RegisterInput {
  email: string;
  password: string;
}

export interface RegisterResult {
  user: { id: string; email: string; role: string; createdAt: Date };
}

export async function register(input: RegisterInput): Promise<RegisterResult> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new AppError("Email already registered", 409, "CONFLICT");
  }
  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      role: "user",
    },
  });
  return {
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    },
  };
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface LoginResult {
  accessToken: string;
  user: { id: string; email: string; role: string };
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

export async function login(input: LoginInput): Promise<LoginResult> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) {
    throw new AppError("Invalid credentials", 401, "UNAUTHORIZED");
  }
  const valid = await bcrypt.compare(input.password, user.passwordHash);
  if (!valid) {
    throw new AppError("Invalid credentials", 401, "UNAUTHORIZED");
  }
  const accessToken = generateAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
  });
  const { refreshTokenValue, expiresAt: refreshExpiresAt } =
    await refreshTokenService.create(user.id);
  return {
    accessToken,
    user: { id: user.id, email: user.email, role: user.role },
    refreshToken: refreshTokenValue,
    refreshTokenExpiresAt: refreshExpiresAt,
  };
}

export interface MeResult {
  user: { id: string; email: string; role: string };
}

export async function getMe(userId: string): Promise<MeResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true },
  });
  if (!user) {
    throw new AppError("User not found", 404, "NOT_FOUND");
  }
  return { user };
}
