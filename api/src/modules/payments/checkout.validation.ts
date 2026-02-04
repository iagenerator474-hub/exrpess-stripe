import { z } from "zod";

const CURRENCIES = ["eur", "usd", "gbp"] as const;

export const checkoutSessionBodySchema = z.object({
  amount: z.number().int().positive("Amount must be a positive integer (cents)"),
  currency: z
    .string()
    .min(1)
    .default("eur")
    .transform((s) => s.toLowerCase())
    .refine((s) => CURRENCIES.includes(s as (typeof CURRENCIES)[number]), {
      message: `Currency must be one of: ${CURRENCIES.join(", ")}`,
    }),
});

export type CheckoutSessionBody = z.infer<typeof checkoutSessionBodySchema>;
