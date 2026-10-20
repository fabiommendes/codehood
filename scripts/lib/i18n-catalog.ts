import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Reads the Paraglide message catalogue and checks it is complete.
 *
 * Paraglide falls back to the base locale when a translation is missing, without
 * a warning, so completeness is checked here instead of at runtime.
 */

/** The parts of `project.inlang/settings.json` the checks read. */
export interface CatalogSettings {
	baseLocale: string;
	locales: string[];
	/// `plugin.inlang.messageFormat.pathPattern`, always as a list, each with a
	/// `{locale}` placeholder: `"./messages/{locale}/forms.json"`.
	pathPatterns: string[];
}

/** The message catalogue: settings plus every JSON file under `messages/`. */
export interface Catalog extends CatalogSettings {
	/// Parsed content of every `.json` file under `messages/`, keyed by its path
	/// relative to the project root, in the same form as the patterns:
	/// `"./messages/en/forms.json"`.
	files: Record<string, unknown>;
}

/** What is wrong with one file or one message of the catalogue. */
export interface CatalogProblem {
	kind:
		| "missing-key"
		| "extra-key"
		| "inputs-mismatch"
		| "unlisted-file"
		| "missing-file"
		| "bad-prefix";
	/// Path of the offending file, as in `Catalog.files`.
	file: string;
	/// Message key, for the kinds that concern a single message.
	key?: string;
	/// Human-readable description, printed by `scripts/i18n-check.ts`.
	message: string;
}

/**
 * Lists every problem of the catalogue, or an empty list when it is complete.
 *
 * A file's area is its base name without `.json`. For each pattern and each
 * non-base locale, the file of that locale must hold exactly the keys of the
 * base locale's file, and each message must declare the same inputs as its base
 * counterpart. Every key must start with `<area>_`, and every file under
 * `messages/` must be produced by some pattern.
 */
export function checkCatalog(catalog: Catalog): CatalogProblem[] {
	const problems: CatalogProblem[] = [];
	const expected = new Set<string>();
	for (const pattern of catalog.pathPatterns) {
		const baseFile = localeFile(pattern, catalog.baseLocale);
		const base = catalog.files[baseFile];
		for (const locale of catalog.locales) {
			const file = localeFile(pattern, locale);
			expected.add(file);
			const content = catalog.files[file];
			if (content === undefined) {
				problems.push({
					kind: "missing-file",
					file,
					message: `${file}: file does not exist (expected by pattern ${pattern})`,
				});
				continue;
			}
			problems.push(...checkPrefixes(file, content));
			if (locale === catalog.baseLocale || base === undefined) continue;
			problems.push(...compareKeys(baseFile, base, file, content));
		}
	}
	for (const file of Object.keys(catalog.files)) {
		if (expected.has(file)) continue;
		problems.push({
			kind: "unlisted-file",
			file,
			message: `${file}: file is not produced by any path pattern`,
		});
	}
	return problems;
}

/// Path of the file a pattern produces for `locale`.
function localeFile(pattern: string, locale: string): string {
	return pattern.replaceAll("{locale}", locale);
}

/// Message keys of a parsed file; empty when the content is not an object.
function messageKeys(content: unknown): string[] {
	if (typeof content !== "object" || content === null) return [];
	return Object.keys(content);
}

/// Key differences of a non-base file against its base file.
function compareKeys(
	baseFile: string,
	base: unknown,
	file: string,
	other: unknown,
): CatalogProblem[] {
	const baseKeys = new Set(messageKeys(base));
	const otherKeys = new Set(messageKeys(other));
	const problems: CatalogProblem[] = [];
	for (const key of baseKeys) {
		if (otherKeys.has(key)) continue;
		problems.push({
			kind: "missing-key",
			file,
			key,
			message: `${file}: missing key "${key}" (present in ${baseFile})`,
		});
	}
	for (const key of otherKeys) {
		if (baseKeys.has(key)) {
			const expected = messageInputs((base as Messages)[key]);
			const actual = messageInputs((other as Messages)[key]);
			if (!sameSet(expected, actual)) {
				problems.push({
					kind: "inputs-mismatch",
					file,
					key,
					message: `${file}: key "${key}" has inputs {${[...actual].sort().join(", ")}}, but ${baseFile} has {${[...expected].sort().join(", ")}}`,
				});
			}
			continue;
		}
		problems.push({
			kind: "extra-key",
			file,
			key,
			message: `${file}: key "${key}" does not exist in ${baseFile}`,
		});
	}
	return problems;
}

/**
 * Loads the catalogue of the project rooted at `root`.
 *
 * @throws When `project.inlang/settings.json` is missing or a message file is
 * not valid JSON.
 */
export function loadCatalog(root: string): Catalog {
	const settingsPath = path.join(root, "project.inlang", "settings.json");
	const raw = readJson(settingsPath) as Record<string, unknown>;
	const pattern = (
		raw["plugin.inlang.messageFormat"] as { pathPattern?: string | string[] }
	)?.pathPattern;
	const settings: CatalogSettings = {
		baseLocale: String(raw.baseLocale),
		locales: (raw.locales as string[]) ?? [],
		pathPatterns: pattern === undefined ? [] : [pattern].flat(),
	};
	const files: Record<string, unknown> = {};
	for (const rel of listJson(path.join(root, "messages"), "./messages")) {
		files[rel] = readJson(path.join(root, rel));
	}
	return { ...settings, files };
}

/**
 * The locale a build should compile for, given the value of `CODEHOOD_LOCALE`.
 *
 * An unset or empty value selects the base locale.
 *
 * @throws When the value is not one of `settings.locales`. The message lists the
 * available locales.
 */
export function resolveBuildLocale(
	value: string | undefined,
	settings: Pick<CatalogSettings, "baseLocale" | "locales">,
): string {
	if (value === undefined || value === "") return settings.baseLocale;
	if (settings.locales.includes(value)) return value;
	throw new Error(
		`CODEHOOD_LOCALE="${value}" is not a known locale. Available locales: ${settings.locales.join(", ")}`,
	);
}

/// A parsed message file: key to message value.
type Messages = Record<string, unknown>;

/// Keys of a file that do not start with `<area>_`.
function checkPrefixes(file: string, content: unknown): CatalogProblem[] {
	const area = (file.split("/").pop() ?? file).replace(/\.json$/, "");
	return messageKeys(content)
		.filter((key) => !key.startsWith(`${area}_`))
		.map((key) => ({
			kind: "bad-prefix" as const,
			file,
			key,
			message: `${file}: key "${key}" must start with "${area}_"`,
		}));
}

/// Names of the inputs a message value uses: undeclared-local placeholders plus `input` declarations.
function messageInputs(value: unknown): Set<string> {
	const texts: string[] = [];
	const locals = new Set<string>();
	const inputs = new Set<string>();
	if (typeof value === "string") texts.push(value);
	else if (Array.isArray(value)) {
		for (const variant of value) {
			if (typeof variant !== "object" || variant === null) continue;
			const { declarations, match } = variant as Record<string, unknown>;
			for (const decl of Array.isArray(declarations) ? declarations : []) {
				const input = /^\s*input\s+(\S+)/.exec(String(decl));
				if (input?.[1]) inputs.add(input[1]);
				const local = /^\s*local\s+(\S+)/.exec(String(decl));
				if (local?.[1]) locals.add(local[1]);
			}
			if (typeof match === "object" && match !== null) {
				for (const text of Object.values(match)) {
					if (typeof text === "string") texts.push(text);
				}
			}
		}
	}
	for (const text of texts) {
		for (const m of text.matchAll(/\{([^{}]+)\}/g)) {
			const name = (m[1] ?? "").trim();
			if (!locals.has(name)) inputs.add(name);
		}
	}
	return inputs;
}

/// Whether two sets hold the same elements.
function sameSet(a: Set<string>, b: Set<string>): boolean {
	return a.size === b.size && [...a].every((x) => b.has(x));
}

/// Parses a JSON file; the error message carries the file path.
function readJson(file: string): unknown {
	let text: string;
	try {
		text = readFileSync(file, "utf8");
	} catch (error) {
		throw new Error(`Cannot read ${file}: ${(error as Error).message}`);
	}
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new Error(`Invalid JSON in ${file}: ${(error as Error).message}`);
	}
}

/// Paths of every `.json` under `dir`, recursively, each prefixed with `prefix`.
function listJson(dir: string, prefix: string): string[] {
	let entries: import("node:fs").Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	return entries.flatMap((entry) => {
		const rel = `${prefix}/${entry.name}`;
		if (entry.isDirectory()) return listJson(path.join(dir, entry.name), rel);
		return entry.name.endsWith(".json") ? [rel] : [];
	});
}
