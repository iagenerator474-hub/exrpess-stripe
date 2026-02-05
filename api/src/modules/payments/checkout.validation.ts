import { z } from "zod";

const CURRENCIES = ["eur", "usd", "gbp"] as const;

/** Max amount in cents (1M = 10 000.00 in main unit). Adjust per business. */
const MAX_AMOUNT_CENTS = 1_000_000;

export const checkoutSessionBodySchema = z.object({
  amount: z
    .number()
    .int("Amount must be an integer (cents)")
    .positive("Amount must be positive")
    .max(MAX_AMOUNT_CENTS, `Amount must not exceed ${MAX_AMOUNT_CENTS} cents`),
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
