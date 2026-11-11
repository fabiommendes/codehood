import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runnersModule } from "@codehood/runner/registry";
import { buildRunnerBundle } from "@codehood/runner/server/integration";
import { defineRunner, type RunnerPluginInput } from "@codehood/runner-api";
import { expect, test } from "@playwright/test";
import { defineConfig } from "@/config";
import { elm, prolog } from "@/runner/plugins";

/// A minimal valid plugin, with `overrides` on top.
function plugin(overrides: Partial<RunnerPluginInput> = {}): RunnerPluginInput {
	return {
		apiVersion: 1,
		id: "demo",
		extension: "demo",
		modes: ["script"],
		defaultMode: "script",
		label: { en: "Demo" },
		driver: "./plugins/demo/driver.js",
		...overrides,
	};
}

test.describe("defineRunner", () => {
	test("adds the id to the aliases and the default file name stays unset", () => {
		const demo = defineRunner(plugin({ aliases: ["dm"] }));
		expect(demo.aliases).toEqual(["demo", "dm"]);
		expect(demo.defaultFilename).toBeUndefined();
	});

	test("refuses a default mode the plugin does not run", () => {
		expect(() => defineRunner(plugin({ defaultMode: "repl" }))).toThrow(
			/demo[\s\S]*defaultMode must be one of modes/,
		);
	});

	test("refuses the reserved fake id", () => {
		expect(() => defineRunner(plugin({ id: "fake" }))).toThrow(/reserved/);
	});

	test("refuses a label without English, the fallback", () => {
		expect(() => defineRunner(plugin({ label: { "pt-BR": "Demo" } }))).toThrow(
			/`en` text/,
		);
	});

	test("refuses another API version", () => {
		expect(() =>
			defineRunner(plugin({ apiVersion: 2 as unknown as 1 })),
		).toThrow(/apiVersion/);
	});
});

test.describe("runner.languages", () => {
	test("two plugins may not share an alias", () => {
		expect(() =>
			defineConfig({
				runner: {
					languages: [defineRunner(plugin({ aliases: ["pl"] })), prolog()],
				},
			}),
		).toThrow(/"pl" is an alias of both "demo" and "prolog"/);
	});

	test("two plugins may not share an id", () => {
		expect(() =>
			defineConfig({ runner: { languages: [prolog(), prolog()] } }),
		).toThrow(/two plugins have the id "prolog"/);
	});
});

test.describe("the generated registry", () => {
	/// Imports the source of a generated module.
	async function evaluate(source: string): Promise<Record<string, unknown>> {
		return import(`data:text/javascript,${encodeURIComponent(source)}`);
	}

	test("texts come in the instance's locale, falling back to English", async () => {
		const { runners } = (await evaluate(
			runnersModule([elm(), defineRunner(plugin())], "pt-BR", "/root", {
				loaders: false,
			}),
		)) as { runners: Record<string, unknown>[] };
		expect(runners[0]).toMatchObject({
			id: "elm",
			label: "Elm",
			defaultFilename: "Main.elm",
			defaultMode: "repl",
			restartNote: "Rodar reinicia o REPL do Elm",
		});
		expect(runners[1]).toMatchObject({
			id: "demo",
			label: "Demo",
			defaultFilename: "main.demo",
			restartNote: null,
		});
	});

	test("without loaders, no editor or grammar is imported", () => {
		const source = runnersModule([elm()], "en", "/root", { loaders: false });
		expect(source).not.toContain("import(");
	});

	test("with loaders, root paths become absolute and grammars come from Shiki", () => {
		const source = runnersModule([elm()], "en", "/root");
		expect(source).toContain(
			'import("/root/src/runner/plugins/elm/editor.ts")',
		);
		expect(source).toContain('import("shiki/langs/elm.mjs")');
	});
});

test.describe("bundle build with plugins", () => {
	/// A project root with an empty sandbox whose frame lists the drivers.
	function project(): string {
		const root = mkdtempSync(join(tmpdir(), "runner-plugins-"));
		const entries = join(root, "src/runner/server/entries");
		mkdirSync(entries, { recursive: true });
		mkdirSync(join(root, "src/runner/sandbox"), { recursive: true });
		mkdirSync(join(root, "src/db"), { recursive: true });
		mkdirSync(join(root, "plugins/demo"), { recursive: true });
		writeFileSync(join(root, "src/db/secret.js"), "export const s = 1;");
		writeFileSync(
			join(root, "src/runner/sandbox/frame.ts"),
			'import drivers from "codehood:runner-drivers";\nexport const load = () => drivers.demo();',
		);
		writeFileSync(
			join(entries, "frame.ts"),
			'import { load } from "../../sandbox/frame";\nload();',
		);
		writeFileSync(join(entries, "worker.ts"), "export {};");
		writeFileSync(join(entries, "sw.ts"), "export {};");
		writeFileSync(
			join(root, "plugins/demo/helper.js"),
			'export const greeting = "demo driver here";',
		);
		return root;
	}

	test("bundles the driver, its own files and what its build step emits", async () => {
		const root = project();
		try {
			writeFileSync(
				join(root, "plugins/demo/driver.js"),
				'import { greeting } from "./helper.js";\nexport default { greeting };',
			);
			writeFileSync(
				join(root, "plugins/demo/build.mjs"),
				'export default async ({ emit }) => emit("demo/data.txt", "built");',
			);
			const out = join(root, "out");
			await buildRunnerBundle(root, out, {
				minify: false,
				source: join(root, "src/runner"),
				plugins: [defineRunner(plugin({ build: "./plugins/demo/build.mjs" }))],
			});
			const manifest = JSON.parse(
				readFileSync(join(out, "manifest.json"), "utf8"),
			);
			expect(manifest.files).toContain("demo/data.txt");
			expect(readFileSync(join(out, "demo/data.txt"), "utf8")).toBe("built");
			const code = readdirSync(out)
				.filter((file) => file.endsWith(".js"))
				.map((file) => readFileSync(join(out, file), "utf8"))
				.join("\n");
			expect(code).toContain("demo driver here");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("a driver that imports outside its plugin breaks the build", async () => {
		const root = project();
		try {
			writeFileSync(
				join(root, "plugins/demo/driver.js"),
				'import { s } from "../../src/db/secret.js";\nexport default { s };',
			);
			await expect(
				buildRunnerBundle(root, join(root, "out"), {
					minify: false,
					source: join(root, "src/runner"),
					plugins: [defineRunner(plugin())],
				}),
			).rejects.toThrow(/may import only/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test.describe("a driver and the plugin contract", () => {
		/// `project()` with `@codehood/runner-api` installed.
		function projectWithApi(): string {
			const root = project();
			mkdirSync(join(root, "node_modules/@codehood"), { recursive: true });
			symlinkSync(
				resolve("packages/runner-api"),
				join(root, "node_modules/@codehood/runner-api"),
			);
			return root;
		}

		test("may import @codehood/runner-api/driver", async () => {
			const root = projectWithApi();
			try {
				writeFileSync(
					join(root, "plugins/demo/driver.js"),
					'import { runtimePath } from "@codehood/runner-api/driver";\nexport default { path: runtimePath({ pkg: "demo-rt", version: "1.0.0", files: {} }, "x.js") };',
				);
				const out = join(root, "out");
				await buildRunnerBundle(root, out, {
					minify: false,
					source: join(root, "src/runner"),
					plugins: [defineRunner(plugin())],
				});
				const code = readdirSync(out)
					.filter((file) => file.endsWith(".js"))
					.map((file) => readFileSync(join(out, file), "utf8"))
					.join("\n");
				expect(code).toContain("function runtimePath");
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});

		test("may not import the plugin descriptor", async () => {
			const root = projectWithApi();
			try {
				writeFileSync(
					join(root, "plugins/demo/driver.js"),
					'import { defineRunner } from "@codehood/runner-api";\nexport default { defineRunner };',
				);
				await expect(
					buildRunnerBundle(root, join(root, "out"), {
						minify: false,
						source: join(root, "src/runner"),
						plugins: [defineRunner(plugin())],
					}),
				).rejects.toThrow(/may import only/);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});
	});

	test("a build step may not write outside the bundle", async () => {
		const root = project();
		try {
			writeFileSync(join(root, "plugins/demo/driver.js"), "export default {};");
			writeFileSync(
				join(root, "plugins/demo/build.mjs"),
				'export default async ({ emit }) => emit("../escaped.txt", "x");',
			);
			await expect(
				buildRunnerBundle(root, join(root, "out"), {
					minify: false,
					source: join(root, "src/runner"),
					plugins: [
						defineRunner(plugin({ build: "./plugins/demo/build.mjs" })),
					],
				}),
			).rejects.toThrow(/outside the bundle/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
