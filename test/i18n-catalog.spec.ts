import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
	type Catalog,
	type CatalogProblem,
	checkCatalog,
	loadCatalog,
	resolveBuildLocale,
} from "../scripts/lib/i18n-catalog";

const EN_FORMS = "./messages/en/forms.json";
const PT_FORMS = "./messages/pt-BR/forms.json";
const EN_GRADES = "./messages/en/grades.json";
const PT_GRADES = "./messages/pt-BR/grades.json";

/// A plural message with the same shape for every locale.
function plural(one: string, other: string) {
	return [
		{
			declarations: ["input count", "local countPlural = count: plural"],
			selectors: ["countPlural"],
			match: { "countPlural=one": one, "countPlural=other": other },
		},
	];
}

/// A complete catalogue for two areas and two locales; `files` replaces
/// whole files by path.
function catalog(files: Record<string, unknown> = {}): Catalog {
	return {
		baseLocale: "en",
		locales: ["en", "pt-BR"],
		pathPatterns: [
			"./messages/{locale}/forms.json",
			"./messages/{locale}/grades.json",
		],
		files: {
			[EN_FORMS]: {
				forms_required: "Required",
				forms_greeting: "Hello, {name}",
			},
			[PT_FORMS]: {
				forms_required: "Obrigatório",
				forms_greeting: "Olá, {name}",
			},
			[EN_GRADES]: {
				grades_submissions: plural("{count} submission", "{count} submissions"),
			},
			[PT_GRADES]: {
				grades_submissions: plural("{count} envio", "{count} envios"),
			},
			...files,
		},
	};
}

/// Problems of a given kind.
function ofKind(problems: CatalogProblem[], kind: CatalogProblem["kind"]) {
	return problems.filter((problem) => problem.kind === kind);
}

test("a complete catalogue has no problems", () => {
	expect(checkCatalog(catalog())).toEqual([]);
});

test("a key missing from a translation is reported against the translation file", () => {
	const problems = checkCatalog(
		catalog({ [PT_FORMS]: { forms_required: "Obrigatório" } }),
	);

	expect(problems).toHaveLength(1);
	expect(problems[0]).toMatchObject({
		kind: "missing-key",
		file: PT_FORMS,
		key: "forms_greeting",
	});
	expect(problems[0]?.message).toBeTruthy();
});

test("a missing variant message is reported as a missing key", () => {
	const problems = checkCatalog(catalog({ [PT_GRADES]: {} }));

	expect(problems).toHaveLength(1);
	expect(problems[0]).toMatchObject({
		kind: "missing-key",
		file: PT_GRADES,
		key: "grades_submissions",
	});
});

test("a key missing from several translations is reported once per file", () => {
	const problems = checkCatalog(catalog({ [PT_FORMS]: {}, [PT_GRADES]: {} }));
	const missing = ofKind(problems, "missing-key");

	expect(missing).toHaveLength(3);
	expect(missing.map((p) => [p.file, p.key]).sort()).toEqual([
		[PT_FORMS, "forms_greeting"],
		[PT_FORMS, "forms_required"],
		[PT_GRADES, "grades_submissions"],
	]);
});

test("a key only in a translation is reported as extra against the translation file", () => {
	const problems = checkCatalog(
		catalog({
			[PT_FORMS]: {
				forms_required: "Obrigatório",
				forms_greeting: "Olá, {name}",
				forms_orphan: "Órfã",
			},
		}),
	);

	expect(problems).toHaveLength(1);
	expect(problems[0]).toMatchObject({
		kind: "extra-key",
		file: PT_FORMS,
		key: "forms_orphan",
	});
	expect(problems[0]?.message).toBeTruthy();
});

test("a key absent from the base file is extra in the translation, never missing in the base", () => {
	const problems = checkCatalog(
		catalog({
			[EN_FORMS]: { forms_required: "Required" },
		}),
	);

	expect(problems.map((p) => [p.kind, p.file, p.key])).toEqual([
		["extra-key", PT_FORMS, "forms_greeting"],
	]);
});

/// The problems as `[kind, file, key]` triples.
function triples(problems: CatalogProblem[]) {
	return problems.map((p) => [p.kind, p.file, p.key]);
}

/// A variant message whose only declared input is `input`.
function pluralOver(input: string) {
	return [
		{
			declarations: [`input ${input}`, `local plural = ${input}: plural`],
			selectors: ["plural"],
			match: {
				"plural=one": `{${input}} envio`,
				"plural=other": `{${input}} envios`,
			},
		},
	];
}

/// `base` without the file at `path`.
function withoutFile(base: Catalog, path: string): Catalog {
	const { [path]: _removed, ...files } = base.files;
	return { ...base, files };
}

test.describe("AC4 inputs-mismatch", () => {
	const inputsMismatch = (translation: unknown) =>
		triples(
			checkCatalog(
				catalog({
					[PT_FORMS]: {
						forms_required: "Obrigatório",
						forms_greeting: translation,
					},
				}),
			),
		);

	test("a renamed placeholder is reported against the translation", () => {
		expect(inputsMismatch("Olá, {nome}")).toEqual([
			["inputs-mismatch", PT_FORMS, "forms_greeting"],
		]);
	});

	test("an extra placeholder is reported", () => {
		expect(inputsMismatch("Olá, {name} {title}")).toEqual([
			["inputs-mismatch", PT_FORMS, "forms_greeting"],
		]);
	});

	test("a missing placeholder is reported", () => {
		expect(inputsMismatch("Olá")).toEqual([
			["inputs-mismatch", PT_FORMS, "forms_greeting"],
		]);
	});

	test("a variant message declaring a different input is reported", () => {
		const problems = checkCatalog(
			catalog({ [PT_GRADES]: { grades_submissions: pluralOver("total") } }),
		);

		expect(triples(problems)).toEqual([
			["inputs-mismatch", PT_GRADES, "grades_submissions"],
		]);
		expect(problems[0]?.message).toBeTruthy();
	});

	test("a string and a variant message with the same inputs match", () => {
		const problems = checkCatalog(
			catalog({
				[EN_GRADES]: { grades_submissions: "{count} submissions" },
			}),
		);

		expect(problems).toEqual([]);
	});

	test("a variant message in the base matches a string with the same placeholder", () => {
		const problems = checkCatalog(
			catalog({ [PT_GRADES]: { grades_submissions: "{count} envios" } }),
		);

		expect(problems).toEqual([]);
	});

	test("placeholder order does not matter", () => {
		const problems = checkCatalog(
			catalog({
				[EN_FORMS]: { forms_required: "Required", forms_greeting: "{a} {b}" },
				[PT_FORMS]: {
					forms_required: "Obrigatório",
					forms_greeting: "{b} {a}",
				},
			}),
		);

		expect(problems).toEqual([]);
	});
});

test.describe("AC5 unlisted-file and missing-file", () => {
	test("a file no pattern produces is unlisted", () => {
		const unlisted = "./messages/en/extra.json";
		const problems = checkCatalog(
			catalog({ [unlisted]: { extra_note: "Note" } }),
		);

		expect(triples(problems)).toEqual([["unlisted-file", unlisted, undefined]]);
		expect(problems[0]?.message).toBeTruthy();
	});

	test("a file of a locale outside the configured locales is unlisted", () => {
		const unlisted = "./messages/fr/forms.json";
		const problems = checkCatalog(
			catalog({ [unlisted]: { forms_required: "Obligatoire" } }),
		);

		expect(triples(problems)).toEqual([["unlisted-file", unlisted, undefined]]);
	});

	test("a missing translation file is reported once, without a missing key per message", () => {
		const problems = checkCatalog(withoutFile(catalog(), PT_FORMS));

		expect(triples(problems)).toEqual([["missing-file", PT_FORMS, undefined]]);
		expect(problems[0]?.message).toBeTruthy();
	});

	test("a missing base file is reported as a missing file", () => {
		const problems = checkCatalog(withoutFile(catalog(), EN_GRADES));

		expect(triples(problems)).toContainEqual([
			"missing-file",
			EN_GRADES,
			undefined,
		]);
		expect(ofKind(problems, "missing-key")).toEqual([]);
	});
});

test.describe("AC6 bad-prefix", () => {
	test("a key with another area's prefix is reported in the file where it appears", () => {
		const problems = checkCatalog(
			catalog({
				[EN_GRADES]: {
					grades_submissions: plural(
						"{count} submission",
						"{count} submissions",
					),
					forms_stray: "Stray",
				},
				[PT_GRADES]: {
					grades_submissions: plural("{count} envio", "{count} envios"),
					forms_stray: "Solta",
				},
			}),
		);

		expect(triples(problems).sort()).toEqual([
			["bad-prefix", EN_GRADES, "forms_stray"],
			["bad-prefix", PT_GRADES, "forms_stray"],
		]);
		expect(problems[0]?.message).toBeTruthy();
	});

	test("a key missing the underscore after the area is reported", () => {
		const problems = checkCatalog(
			catalog({
				[EN_FORMS]: { forms_required: "Required", formsx: "X" },
				[PT_FORMS]: { forms_required: "Obrigatório", formsx: "X" },
			}),
		);

		expect(triples(problems).sort()).toEqual([
			["bad-prefix", EN_FORMS, "formsx"],
			["bad-prefix", PT_FORMS, "formsx"],
		]);
	});
});

const LOCALES = { baseLocale: "en", locales: ["en", "pt-BR"] };

test.describe("AC7 resolveBuildLocale", () => {
	for (const value of [undefined, ""]) {
		test(`${JSON.stringify(value)} selects the base locale`, () => {
			expect(resolveBuildLocale(value, LOCALES)).toBe("en");
		});
	}

	test("a configured locale is selected", () => {
		expect(resolveBuildLocale("pt-BR", LOCALES)).toBe("pt-BR");
	});

	test("an unknown locale throws an error listing the available ones", () => {
		expect(() => resolveBuildLocale("fr", LOCALES)).toThrow(
			/fr[\s\S]*en[\s\S]*pt-BR|fr[\s\S]*pt-BR[\s\S]*en/,
		);
	});
});

test.describe("AC7 loadCatalog", () => {
	let root: string;

	test.beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-catalog-"));
	});

	test.afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true });
	});

	/// Writes `content` (stringified unless a string) at `relative` under the root.
	function write(relative: string, content: unknown) {
		const file = path.join(root, relative);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const text =
			typeof content === "string" ? content : JSON.stringify(content);
		fs.writeFileSync(file, text);
	}

	/// Writes `settings.json` with the given `pathPattern` value.
	function writeSettings(pathPattern: unknown) {
		write("project.inlang/settings.json", {
			baseLocale: "en",
			locales: ["en", "pt-BR"],
			"plugin.inlang.messageFormat": { pathPattern },
		});
	}

	test("reads settings and every message file keyed by relative path", () => {
		writeSettings(["./messages/{locale}/forms.json"]);
		write("messages/en/forms.json", { forms_required: "Required" });
		write("messages/pt-BR/forms.json", { forms_required: "Obrigatório" });
		write("messages/en/extra.json", { extra_note: "Note" });

		const catalog = loadCatalog(root);

		expect(catalog.baseLocale).toBe("en");
		expect(catalog.locales).toEqual(["en", "pt-BR"]);
		expect(catalog.pathPatterns).toEqual(["./messages/{locale}/forms.json"]);
		expect(catalog.files).toEqual({
			[EN_FORMS]: { forms_required: "Required" },
			[PT_FORMS]: { forms_required: "Obrigatório" },
			"./messages/en/extra.json": { extra_note: "Note" },
		});
	});

	test("a single string pattern becomes a one-item list", () => {
		writeSettings("./messages/{locale}/forms.json");
		write("messages/en/forms.json", {});

		expect(loadCatalog(root).pathPatterns).toEqual([
			"./messages/{locale}/forms.json",
		]);
	});

	test("throws when settings.json is missing", () => {
		writeSettings(["./messages/{locale}/forms.json"]);
		write("messages/en/forms.json", {});
		expect(() => loadCatalog(root)).not.toThrow();

		fs.rmSync(path.join(root, "project.inlang"), { recursive: true });

		expect(() => loadCatalog(root)).toThrow();
	});

	test("throws when a message file is not valid JSON", () => {
		writeSettings(["./messages/{locale}/forms.json"]);
		write("messages/en/forms.json", {});
		expect(() => loadCatalog(root)).not.toThrow();

		write("messages/en/forms.json", "{ not json");

		expect(() => loadCatalog(root)).toThrow();
	});
});

test("AC7 the project's own catalogue is complete", () => {
	expect(checkCatalog(loadCatalog(process.cwd()))).toEqual([]);
});
