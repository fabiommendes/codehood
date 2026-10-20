/**
 * Paraglide compiler options shared by the Vite plugin in `astro.config.mjs`
 * and by `pnpm run generate`, so both emit the same code.
 */
import path from "node:path";
import type { CompilerOptions } from "@inlang/paraglide-js";
import { loadCatalog, resolveBuildLocale } from "./i18n-catalog";

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
		experimentalStaticLocale: `typeof ${LOCALE_GLOBAL} === 'undefined' ? ${JSON.stringify(baseLocale)} : ${LOCALE_GLOBAL}`,
	};
}

/**
 * The Vite `define` entries that fix the build locale.
 *
 * @throws When `CODEHOOD_LOCALE` is set to a locale the project does not have.
 */
export function localeDefine(
	root: string,
	env: NodeJS.ProcessEnv,
): Record<string, string> {
	const settings = loadCatalog(root);
	return {
		[LOCALE_GLOBAL]: JSON.stringify(
			resolveBuildLocale(env.CODEHOOD_LOCALE, settings),
		),
	};
}
