import { userService } from "@/db/user.service";

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

	await userService.create({
		email: DEV_ADMIN_EMAIL,
		username: DEV_ADMIN_USERNAME,
		name: "Admin",
		role: "ADMIN",
		password: DEV_ADMIN_PASSWORD,
	});
	console.log(
		`[dev] created default admin account: ${DEV_ADMIN_EMAIL} / ${DEV_ADMIN_PASSWORD}`,
	);
}
