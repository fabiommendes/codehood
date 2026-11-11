import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { defineConfig, env } from "@/config";
import { configPath } from "@/config/path";
import { defaultRunners } from "@/runner/plugins";

/// Prints `expression` over `src/core/constants.ts` from a fresh Node process.
function constantsIn(
	vars: Record<string, string | undefined>,
	expression: string,
): string {
	return execFileSync(
		"node_modules/.bin/tsx",
		[
			"-e",
			`import("@/core/constants").then((m) => console.log(JSON.stringify(${expression})));`,
		],
		{ env: { ...process.env, ...vars }, encoding: "utf8" },
	).trim();
}

test.describe("defineConfig", () => {
	test("an empty configuration takes every default", () => {
		expect(defineConfig({})).toEqual({
			instance: {
				publicUrl: "http://localhost:4321",
				locale: "en",
				timeZone: "America/Sao_Paulo",
				schoolIdPattern: "",
			},
			storage: {
				resourceRoot: "./storage/resources",
				attachmentLinkMode: "symlink",
				quota: { instructor: "1gb", student: "200mb" },
			},
			runner: { origin: null, languages: defaultRunners() },
		});
	});

	test("the default languages are Python, JavaScript and TypeScript", () => {
		expect(defineConfig({}).runner.languages.map((p) => p.id)).toEqual([
			"python",
			"javascript",
			"typescript",
		]);
	});

	test("the public URL is reduced to its origin", () => {
		const config = defineConfig({
			instance: { publicUrl: "https://codehood.example/some/path" },
		});
		expect(config.instance.publicUrl).toBe("https://codehood.example");
	});

	test("invalid values fail with the path of each key", () => {
		const invalid = () =>
			defineConfig({
				instance: {
					publicUrl: "ftp://codehood.example",
					timeZone: "Mars/Olympus",
					schoolIdPattern: "[0-9",
				},
				storage: { attachmentLinkMode: "teleport" },
			});
		expect(invalid).toThrow(/instance\.publicUrl/);
		expect(invalid).toThrow(/instance\.timeZone/);
		expect(invalid).toThrow(/instance\.schoolIdPattern/);
		expect(invalid).toThrow(/storage\.attachmentLinkMode/);
	});
});

test.describe("env", () => {
	test("a blank variable counts as unset", () => {
		process.env.CODEHOOD_TEST_BLANK = "  ";
		try {
			expect(env("CODEHOOD_TEST_BLANK")).toBeUndefined();
			expect(env("CODEHOOD_TEST_BLANK", "fallback")).toBe("fallback");
		} finally {
			delete process.env.CODEHOOD_TEST_BLANK;
		}
	});
});

test.describe("configPath", () => {
	test("defaults to codehood.config.ts at the root", () => {
		expect(configPath("/srv/app", {})).toBe("/srv/app/codehood.config.ts");
		expect(configPath("/srv/app", { CODEHOOD_CONFIG: " " })).toBe(
			"/srv/app/codehood.config.ts",
		);
	});

	test("CODEHOOD_CONFIG is relative to the root unless absolute", () => {
		expect(configPath("/srv/app", { CODEHOOD_CONFIG: "deploy/c.ts" })).toBe(
			"/srv/app/deploy/c.ts",
		);
		expect(configPath("/srv/app", { CODEHOOD_CONFIG: "/etc/c.ts" })).toBe(
			"/etc/c.ts",
		);
	});
});

test.describe("the default codehood.config.ts", () => {
	test("ignores the old variables of build-time constants", () => {
		const vars = {
			CODEHOOD_CONFIG: "",
			PUBLIC_URL: "https://codehood.example",
			RUNNER_ORIGIN: "https://runner.example",
		};
		expect(constantsIn(vars, "[m.PUBLIC_URL, m.RUNNER_ORIGIN]")).toBe(
			JSON.stringify(["http://localhost:4321", "http://127.0.0.1:4321"]),
		);
	});

	test("reads the boot-time settings from the environment", () => {
		const vars = {
			CODEHOOD_CONFIG: "",
			RESOURCE_ROOT: "/var/blobs",
			BLOB_QUOTA_STUDENT: "1mb",
		};
		expect(
			constantsIn(vars, "[m.RESOURCE_ROOT, m.BLOB_QUOTA_BY_ROLE.STUDENT]"),
		).toBe(JSON.stringify(["/var/blobs", 1024 * 1024]));
	});
});
