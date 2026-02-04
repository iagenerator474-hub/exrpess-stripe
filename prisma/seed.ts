import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const DEMO_EMAIL = "demo@example.com";
const DEMO_PASSWORD = "DemoPassword12"; // min 10 caractères

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
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
