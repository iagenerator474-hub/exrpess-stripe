import { z } from "zod";

/** Server-priced checkout: client sends only productId. Amount/currency come from Product in DB. */
export const checkoutSessionBodySchema = z
  .object({
    productId: z.string().min(1, "productId is required"),
  })
  .strict();

export type CheckoutSessionBody = z.infer<typeof checkoutSessionBodySchema>;
