import { prisma } from "../../lib/prisma.js";

export interface ProductPublic {
  id: string;
  name: string;
  amountCents: number;
  currency: string;
}

export async function listActiveProducts(): Promise<ProductPublic[]> {
  const rows = await prisma.product.findMany({
    where: { active: true },
    select: { id: true, name: true, amountCents: true, currency: true },
    orderBy: { amountCents: "asc" },
  });
  return rows;
}
