import "dotenv/config";
import { defineConfig, env } from "prisma/config";

/** Like env(), but accepts fallback values for non-existing environment variables */
function envOr(key: string, fallback: string) {
	try {
		return env(key);
	} catch {
		return fallback;
	}
}

export default defineConfig({
	schema: "prisma/schema.prisma",
	migrations: {
		path: "prisma/migrations",
		seed: "tsx prisma/seed.ts",
	},
	datasource: {
		url: envOr("DATABASE_URL", "file:./dev.db"),
	},
});
