/**
 * The registry of runner languages, built from the plugins a configuration
 * lists.
 *
 * Bundles import it as `codehood:runners`, a module generated at build by
 * `runnersModule` (safe in the browser: data plus lazy `import()`s). Code
 * that runs outside a bundle gets the same values from `registry-node.ts`.
 * The sandbox gets its drivers from `driversModule`.
 */

import { resolve } from "node:path";
import { localizedText, type RunnerPlugin } from "./plugin";
import type { LanguageId, RunMode } from "./protocol";
import type { RuntimePackage } from "./sandbox/runtimes";

/** What the app knows of a language. */
export interface RunnerInfo {
	readonly id: LanguageId;
	/// Lowercase tags that map to this language, the id included.
	readonly aliases: readonly string[];
	readonly extension: string;
	readonly defaultFilename: string;
	readonly modes: readonly RunMode[];
	readonly defaultMode: RunMode;
	/// Name shown in the widget, in the instance's locale.
	readonly label: string;
	/// Shown next to Run when each Run starts the program over.
	readonly restartNote: string | null;
	/// Loads the module whose default export returns the CodeMirror extension.
	readonly editor: (() => Promise<{ default: () => unknown }>) | null;
	/// Shiki grammar: the language name and a loader of its module.
	readonly grammar: {
		readonly name: string;
		load(): Promise<unknown>;
	} | null;
}

/// The data of `RunnerInfo`, without the loaders.
type RunnerData = Omit<RunnerInfo, "editor" | "grammar">;

/// Module specifier of a grammar Shiki bundles.
function shikiGrammar(name: string): string {
	return `shiki/langs/${name}.mjs`;
}

/**
 * Resolves a plugin's module specifier against the project root.
 *
 * `./path` and `../path` become absolute paths; package specifiers stay as
 * they are, for the bundler to resolve from the root.
 */
export function resolveSpecifier(root: string, specifier: string): string {
	return specifier.startsWith("./") || specifier.startsWith("../")
		? resolve(root, specifier)
		: specifier;
}

/// What `RunnerInfo` holds besides the loaders.
function runnerData(plugin: RunnerPlugin, locale: string): RunnerData {
	return {
		id: plugin.id,
		aliases: plugin.aliases,
		extension: plugin.extension,
		defaultFilename: plugin.defaultFilename ?? `main.${plugin.extension}`,
		modes: plugin.modes,
		defaultMode: plugin.defaultMode,
		label: localizedText(plugin.label, locale),
		restartNote: plugin.notes.restart
			? localizedText(plugin.notes.restart, locale)
			: null,
	};
}

/// The grammar module and name of `plugin`, or null.
function grammarOf(
	plugin: RunnerPlugin,
	root: string,
): { name: string; module: string } | null {
	const { grammar } = plugin;
	if (!grammar) return null;
	return "shiki" in grammar
		? { name: grammar.shiki, module: shikiGrammar(grammar.shiki) }
		: { name: grammar.name, module: resolveSpecifier(root, grammar.module) };
}

/// Every runtime the plugins carry, each package once.
export function pluginRuntimes(
	plugins: readonly RunnerPlugin[],
): RuntimePackage[] {
	const seen = new Map<string, RuntimePackage>();
	for (const runtime of plugins.flatMap((plugin) => plugin.runtimes)) {
		const key = `${runtime.pkg}@${runtime.version}`;
		if (!seen.has(key)) seen.set(key, runtime);
	}
	return [...seen.values()];
}

/**
 * Source of the `codehood:runners` module for a bundle.
 *
 * Exports `runners` (a `RunnerInfo` per plugin, texts in `locale`) and
 * `runtimes` (every runtime package to serve). Without `loaders`, `editor`
 * and `grammar` are null: for a server-only bundle, which never opens an
 * editor and should not carry one.
 */
export function runnersModule(
	plugins: readonly RunnerPlugin[],
	locale: string,
	root: string,
	{ loaders = true }: { loaders?: boolean } = {},
): string {
	const entries = plugins.map((plugin) => {
		const data = JSON.stringify(runnerData(plugin, locale));
		const editor =
			loaders && plugin.editor
				? `() => import(${JSON.stringify(resolveSpecifier(root, plugin.editor))})`
				: "null";
		const grammar = loaders ? grammarOf(plugin, root) : null;
		const grammarCode = grammar
			? `{ name: ${JSON.stringify(grammar.name)}, load: () => import(${JSON.stringify(grammar.module)}) }`
			: "null";
		return `\t{ ...${data}, editor: ${editor}, grammar: ${grammarCode} },`;
	});
	return [
		"export const runners = [",
		...entries,
		"];",
		`export const runtimes = ${JSON.stringify(pluginRuntimes(plugins))};`,
		"",
	].join("\n");
}

/**
 * The registry for code that runs outside a bundle, loaders included.
 */
export function runnersRegistry(
	plugins: readonly RunnerPlugin[],
	locale: string,
	root: string,
	load: (module: string) => Promise<unknown>,
): { runners: RunnerInfo[]; runtimes: RuntimePackage[] } {
	return {
		runners: plugins.map((plugin) => {
			const editor = plugin.editor
				? resolveSpecifier(root, plugin.editor)
				: null;
			const grammar = grammarOf(plugin, root);
			return {
				...runnerData(plugin, locale),
				editor: editor
					? () => load(editor) as Promise<{ default: () => unknown }>
					: null,
				grammar: grammar
					? { name: grammar.name, load: () => load(grammar.module) }
					: null,
			};
		}),
		runtimes: pluginRuntimes(plugins),
	};
}

/**
 * Source of the sandbox's `codehood:runner-drivers` module: a default export
 * mapping each language id to a loader of its driver.
 */
export function driversModule(
	plugins: readonly RunnerPlugin[],
	root: string,
): string {
	const entries = plugins.map(
		(plugin) =>
			`\t${JSON.stringify(plugin.id)}: () => import(${JSON.stringify(resolveSpecifier(root, plugin.driver))}).then((m) => m.default),`,
	);
	return ["export default {", ...entries, "};", ""].join("\n");
}
