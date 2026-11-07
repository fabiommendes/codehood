/**
 * Registry of language drivers, each loaded on demand.
 */

import type { LanguageId } from "../../protocol";
import type { Driver } from "../driver";

/// Lazy loaders, one per language. A new language is one entry here and one
/// module next to this file.
const DRIVERS: Record<LanguageId, () => Promise<Driver>> = {
	javascript: async () => (await import("./javascript")).javascriptDriver,
	lua: async () => (await import("./lua")).luaDriver,
	prolog: async () => (await import("./prolog")).prologDriver,
	typescript: async () => (await import("./typescript")).typescriptDriver,
	python: async () => (await import("./python")).pythonDriver,
	fake: async () => (await import("./fake")).fakeDriver,
};

/**
 * Languages this frame announces in `ready`.
 *
 * `fake` is announced only when `withFake` is true (any environment but production).
 */
export function availableLanguages(withFake: boolean): LanguageId[] {
	return (Object.keys(DRIVERS) as LanguageId[]).filter(
		(id) => withFake || id !== "fake",
	);
}

/** Imports the driver for `language`. */
export async function loadDriver(language: LanguageId): Promise<Driver> {
	return DRIVERS[language]();
}
