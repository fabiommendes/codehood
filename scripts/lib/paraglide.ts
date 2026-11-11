/**
 * Paraglide compiler options shared by the Vite plugin in `astro.config.mjs`
 * and by `pnpm run generate`, so both emit the same code.
 */
import path from "node:path";
import {
	type CompilerOptions,
	paraglideVitePlugin,
} from "@inlang/paraglide-js";
import { loadCatalog, resolveBuildLocale } from "./i18n-catalog";

/// A single Vite plugin, as returned by Paraglide (`vite` is not a direct dependency).
type Plugin = Exclude<ReturnType<typeof paraglideVitePlugin>, unknown[]>;

/// Global the Vite `define` replaces with the build locale, as a JSON string.
export const LOCALE_GLOBAL = "__CODEHOOD_LOCALE__";

/**
 * Compiler options for the project rooted at `root`.
 *
 * The static locale expression reads {@link LOCALE_GLOBAL} and falls back to the
 * base locale where it is not defined (code run outside Vite, as in tests).
 */
export function paraglideOptions(root: string): CompilerOptions {
	const { baseLocale } = loadCatalog(root);
	return {
		project: path.join(root, "project.inlang"),
		outdir: path.join(root, "src", "generated", "paraglide"),
		strategy: ["baseLocale"],
		emitTsDeclarations: true,
		// The Vite plugin's default. Stating it here makes `pnpm run generate`
		// write the same files, so the plugin's cache stays valid and the dev
		// server does not compile the messages a second time.
		outputStructure:
			process.env.NODE_ENV === "production"
				? "message-modules"
				: "locale-modules",
		experimentalStaticLocale: `typeof ${LOCALE_GLOBAL} === 'undefined' ? ${JSON.stringify(baseLocale)} : ${LOCALE_GLOBAL}`,
	};
}

/**
 * The Paraglide Vite plugin, recompiling only when a message file or the inlang
 * project changes.
 *
 * The stock plugin recompiles on any file event that arrives before its
 * `buildStart`. Astro starts more than one Vite server and writes
 * `.astro/*.d.ts` while they boot, so every dev start paid a full compile.
 */
export function paraglidePlugin(root: string): Plugin {
	const options = paraglideOptions(root);
	const plugin = paraglideVitePlugin(options) as Plugin;
	const watchChange = plugin.watchChange;
	if (typeof watchChange !== "function") return plugin;
	const inputs = [path.join(root, "messages"), options.project].map(
		(dir) => `${dir}${path.sep}`,
	);
	plugin.watchChange = function (id, change) {
		if (!inputs.some((dir) => path.resolve(id).startsWith(dir))) return;
		return watchChange.call(this, id, change);
	};
	return plugin;
}

/**
 * The Vite `define` entries that fix the build locale.
 *
 * @throws When `locale` is not a locale the project has.
 */
export function localeDefine(
	root: string,
	locale: string | undefined,
): Record<string, string> {
	const settings = loadCatalog(root);
	return {
		[LOCALE_GLOBAL]: JSON.stringify(resolveBuildLocale(locale, settings)),
	};
}
