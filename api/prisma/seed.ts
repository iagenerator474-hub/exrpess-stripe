import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const DEMO_EMAIL = "demo@example.com";
const DEMO_PASSWORD = "DemoPassword12"; // min 10 caractères

const PRODUCTS = [
  { name: "Basic", amountCents: 999, currency: "eur" },
  { name: "Pro", amountCents: 2999, currency: "eur" },
  { name: "Enterprise", amountCents: 9999, currency: "eur" },
];

async function main() {
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: { passwordHash: hash },
    create: {
      email: DEMO_EMAIL,
      passwordHash: hash,
      role: "user",
    },
  });
  console.log("Utilisateur démo prêt :", user.email);
  console.log("  → Email:", DEMO_EMAIL);
  console.log("  → Mot de passe:", DEMO_PASSWORD);

  for (const p of PRODUCTS) {
    const existing = await prisma.product.findFirst({ where: { name: p.name } });
    if (!existing) {
      await prisma.product.create({ data: { ...p, active: true } });
      console.log("  → Produit créé:", p.name, p.amountCents, "cents");
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
