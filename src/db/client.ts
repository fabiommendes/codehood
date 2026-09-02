import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../generated/prisma/client";

export type {
	ApiKey,
	ApiKeyKind,
	CalendarEvent,
	Course,
	Discipline,
	Edition,
	Enrollment,
	EnrollmentStatus,
	EventKind,
	Exam,
	ExamStatus,
	File,
	Invite,
	InviteKind,
	Passphrase,
	Prisma,
	Resource,
	ResourceType,
	Role,
	Session,
	TimeSlot,
	User,
	Weekday,
} from "../generated/prisma/client";
export { PrismaClient } from "../generated/prisma/client";

type PrismaTxFn = Parameters<PrismaClient["$transaction"]>[0];
export type PrismaTx = Parameters<PrismaTxFn>[0];

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const adapter = new PrismaBetterSqlite3({
	url: process.env.DATABASE_URL ?? "file:./dev.db",
});

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

// We inject the prisma client into the global object to use in tests.
if (process.env.NODE_ENV !== "production") {
	globalForPrisma.prisma = prisma;
}
