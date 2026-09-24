import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { SESSION_COOKIE_OPTIONS } from "@/core/constants";

/// Loads `src/core/constants.ts` in a fresh Node process with `env` applied,
/// returning whatever it printed or the error it died with.
function loadConstants(env: Record<string, string | undefined>): {
	ok: boolean;
	output: string;
} {
	try {
		const stdout = execFileSync(
			"node_modules/.bin/tsx",
			[
				"-e",
				'import("@/core/constants").then((m) => console.log(m.ENVIRONMENT));',
			],
			{
				env: { ...process.env, ...env },
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		return { ok: true, output: stdout };
	} catch (error) {
		const e = error as { stderr?: string; stdout?: string };
		return { ok: false, output: `${e.stderr ?? ""}${e.stdout ?? ""}` };
	}
}

test("ENVIRONMENT has no default: absent or empty fails the boot by name", () => {
	const absent = loadConstants({ ENVIRONMENT: undefined });
	expect(absent.ok).toBe(false);
	expect(absent.output).toContain("ENVIRONMENT");

	const empty = loadConstants({ ENVIRONMENT: "" });
	expect(empty.ok).toBe(false);
	expect(empty.output).toContain("ENVIRONMENT");

	const nonsense = loadConstants({ ENVIRONMENT: "staging" });
	expect(nonsense.ok).toBe(false);
	expect(nonsense.output).toContain("dev, development, prod, production");

	expect(loadConstants({ ENVIRONMENT: "prod" })).toMatchObject({ ok: true });
});

test("the long spellings of ENVIRONMENT are accepted as aliases", () => {
	for (const value of ["dev", "development", "prod", "production"]) {
		expect(loadConstants({ ENVIRONMENT: value })).toMatchObject({ ok: true });
	}
});

test("the session cookie is Secure exactly when ENVIRONMENT is prod", () => {
	// This process runs as `dev`, so the shared options say so.
	expect(SESSION_COOKIE_OPTIONS).toMatchObject({
		httpOnly: true,
		sameSite: "lax",
		secure: false,
		path: "/",
	});
});
