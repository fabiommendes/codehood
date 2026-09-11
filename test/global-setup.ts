import { TEST_DATABASE_URL } from "./db-path";

/**
 * Fails the run when the test process is not pointed at the test database.
 *
 * `src/db/client.ts` falls back to `file:./dev.db` when `DATABASE_URL` is
 * unset, and `playwright.config.ts` pins the *server's* copy to the test
 * database no matter what. Launching Playwright directly rather than through
 * `test/run.ts` therefore splits the two processes across two databases: the
 * factories seed one, the server reads the other, and every test that needs a
 * seeded user fails as though login were broken. Worse, the writes land in the
 * developer's real `dev.db`.
 *
 * Nothing about that is visible in the failure, so it gets caught here instead.
 */
export default function assertTestDatabase(): void {
	if (process.env.DATABASE_URL === TEST_DATABASE_URL) return;

	const actual = process.env.DATABASE_URL ?? "unset (would use dev.db)";
	throw new Error(
		[
			"Tests were started without the test database.",
			"",
			`  DATABASE_URL: ${actual}`,
			`  expected:     ${TEST_DATABASE_URL}`,
			"",
			"Run tests through test/run.ts, which wipes the database file and",
			"pushes the schema before Playwright starts:",
			"",
			"  pnpm test                          # everything",
			"  pnpm exec tsx test/run.ts test/stories/   # one directory",
			"  pnpm run test-ui                   # UI mode",
			"",
			"`playwright test` and `playwright test --ui` skip that setup.",
		].join("\n"),
	);
}
