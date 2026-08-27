import { FULL_ACCESS } from "@/db/base-service";
import { courseService } from "@/db/course.service";
import { disciplineService } from "@/db/discipline.service";
import { type User, userService } from "@/db/user.service";

const DEV_ADMIN_USERNAME = "admin";
const DEV_ADMIN_EMAIL = "admin@codehood.local";
const DEV_ADMIN_PASSWORD = "admin";

let devAdminPromise: Promise<void> | null = null;

/**
 * Dev-only convenience: seeds a default admin account when the database has no users yet.
 * Called both from request middleware (self-healing on first request) and from the Prisma
 * seed script (`manage seed` / `prisma db seed`) — memoized so either call site is cheap
 * after the first one, and safe to await concurrently instead of racing.
 */
export function ensureDevAdmin(): Promise<void> {
	if (process.env.NODE_ENV === "production") {
		console.log("[seed] production mode: skipping default admin account.");
		return Promise.resolve();
	}
	devAdminPromise ??= createDevAdminIfMissing();
	return devAdminPromise;
}

async function createDevAdminIfMissing(): Promise<void> {
	if ((await userService.count()) > 0) {
		console.log("[seed] users already exist, skipping default admin account.");
		return;
	}

	await userService.create(
		{
			email: DEV_ADMIN_EMAIL,
			username: DEV_ADMIN_USERNAME,
			name: "Admin",
			role: "ADMIN",
			password: DEV_ADMIN_PASSWORD,
		},
		FULL_ACCESS,
	);
	console.log(
		`[dev] created default admin account: ${DEV_ADMIN_EMAIL} / ${DEV_ADMIN_PASSWORD}`,
	);
}

let demoCoursesPromise: Promise<void> | null = null;

/**
 * Dev-only convenience: seeds two demo courses (with instructors and enrolled
 * students) when the database has no courses yet. Self-healing on first
 * request, same pattern as {@link ensureDevAdmin} — Playwright specs need a
 * course to open, and `/courses` renders nothing useful on a fresh database
 * otherwise.
 */
export function ensureDemoCourses(): Promise<void> {
	if (process.env.NODE_ENV === "production") {
		return Promise.resolve();
	}
	demoCoursesPromise ??= createDemoCoursesIfMissing();
	return demoCoursesPromise;
}

async function demoUser(input: {
	email: string;
	username: string;
	name: string;
	role: "INSTRUCTOR" | "STUDENT";
	password: string;
}): Promise<User> {
	const existing = await userService.findOne(
		{ username: input.username },
		FULL_ACCESS,
	);
	if (existing) return existing;
	return userService.create(
		{ ...input, githubId: input.username, schoolId: input.username },
		FULL_ACCESS,
	);
}

async function createDemoCoursesIfMissing(): Promise<void> {
	const existing = await courseService.findMany({}, FULL_ACCESS);
	if (existing.length > 0) {
		console.log("[seed] courses already exist, skipping demo courses.");
		return;
	}

	const ada = await demoUser({
		email: "ada@codehood.local",
		username: "ada",
		name: "Ada Lovelace",
		role: "INSTRUCTOR",
		password: "instructor",
	});
	const turing = await demoUser({
		email: "turing@codehood.local",
		username: "turing",
		name: "Alan Turing",
		role: "INSTRUCTOR",
		password: "instructor",
	});
	const hopper = await demoUser({
		email: "hopper@codehood.local",
		username: "hopper",
		name: "Grace Hopper",
		role: "STUDENT",
		password: "student",
	});
	const hamilton = await demoUser({
		email: "hamilton@codehood.local",
		username: "hamilton",
		name: "Margaret Hamilton",
		role: "STUDENT",
		password: "student",
	});
	const liskov = await demoUser({
		email: "liskov@codehood.local",
		username: "liskov",
		name: "Barbara Liskov",
		role: "STUDENT",
		password: "student",
	});

	for (const discipline of [
		{ slug: "cs101", name: "Introduction to Programming" },
		{ slug: "cs201", name: "Data Structures" },
	]) {
		await disciplineService.create(discipline, FULL_ACCESS);
	}

	const cs101 = await courseService.create(
		{
			disciplineSlug: "cs101",
			instructorUsername: ada.username,
			edition: "2026-1",
			description:
				"A first course in programming: variables, control flow, functions, and enough data structures to get dangerous.",
			startAt: new Date("2026-01-05"),
			endAt: new Date("2026-05-15"),
		},
		FULL_ACCESS,
	);
	const cs201 = await courseService.create(
		{
			disciplineSlug: "cs201",
			instructorUsername: turing.username,
			edition: "2026-1",
			description:
				"Arrays, linked lists, trees, and graphs, with an eye toward complexity.",
			startAt: new Date("2026-01-05"),
			endAt: new Date("2026-05-15"),
		},
		FULL_ACCESS,
	);

	for (const student of [hopper, hamilton, liskov]) {
		await courseService.enroll(
			{ courseId: cs101.id, userId: student.id },
			FULL_ACCESS,
		);
	}
	await courseService.enroll(
		{ courseId: cs201.id, userId: hamilton.id },
		FULL_ACCESS,
	);

	console.log(
		`[dev] created demo courses cs101/${ada.username}_2026-1 and cs201/${turing.username}_2026-1.`,
	);
}
