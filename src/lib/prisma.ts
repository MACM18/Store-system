import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
// Keep builds independent of deployment secrets. The container's migration step
// requires DATABASE_URL before the server is started.
const connectionString = process.env.DATABASE_URL ?? "postgresql://store:store@localhost:5432/store_system";

const adapter = new PrismaPg({ connectionString });
export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
