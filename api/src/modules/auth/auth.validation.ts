import { z } from "zod";

const passwordSchema = z.string().min(10, "Password must be at least 10 characters");

export const registerBodySchema = z.object({
  email: z.string().email("Invalid email"),
  password: passwordSchema,
});

export const loginBodySchema = z.object({
  email: z.string().email("Invalid email"),
  password: passwordSchema,
});

export const refreshBodySchema = z.object({
  refreshToken: z.string().min(1).optional(),
});

export type RegisterBody = z.infer<typeof registerBodySchema>;
export type LoginBody = z.infer<typeof loginBodySchema>;
export type RefreshBody = z.infer<typeof refreshBodySchema>;
