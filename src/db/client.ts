import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../generated/prisma/client";

export type { ApiKeyKind, InviteKind, Role, User } from "../generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const adapter = new PrismaBetterSqlite3({
	url: process.env.DATABASE_URL ?? "file:./dev.db",
});

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

// We inject the prisma client into the global object to use in tests.
if (process.env.NODE_ENV !== "production") {
	globalForPrisma.prisma = prisma;
}
