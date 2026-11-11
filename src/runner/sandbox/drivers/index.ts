/**
 * Registry of language drivers, each loaded on demand.
 *
 * The drivers are those of the plugins in `runner.languages`, which the
 * bundle build writes into `codehood:runner-drivers`, plus `fake`.
 */

import drivers from "codehood:runner-drivers";
import type { LanguageId } from "../../protocol";
import type { Driver } from "../driver";

/// Lazy loaders, one per language.
const DRIVERS: Readonly<Record<LanguageId, () => Promise<Driver>>> = {
	...drivers,
	fake: async () => (await import("./fake")).fakeDriver,
};

/**
 * Languages this frame announces in `ready`.
 *
 * `fake` is announced only when `withFake` is true (any environment but production).
 */
export function availableLanguages(withFake: boolean): LanguageId[] {
	return Object.keys(DRIVERS).filter((id) => withFake || id !== "fake");
}

/**
 * Imports the driver for `language`.
 *
 * @throws {Error} when no plugin of this bundle runs `language`.
 */
export async function loadDriver(language: LanguageId): Promise<Driver> {
	if (!Object.hasOwn(DRIVERS, language)) {
		throw new Error(`No driver for "${language}" in this bundle.`);
	}
	return (DRIVERS[language] as () => Promise<Driver>)();
}
