/**
 * The runner plugins of an instance, as `runner.languages` lists them.
 *
 * What a single plugin declares is the contract in `@codehood/runner-api`.
 */

import { runnerPlugin } from "@codehood/runner-api";
import { z } from "zod";

/// Plugin lists with distinct ids and aliases.
export const runnerPlugins = z
	.array(runnerPlugin)
	.superRefine((plugins, ctx) => {
		const ids = new Set<string>();
		const aliases = new Map<string, string>();
		for (const plugin of plugins) {
			if (ids.has(plugin.id)) {
				ctx.addIssue({
					code: "custom",
					message: `two plugins have the id "${plugin.id}"`,
				});
			}
			ids.add(plugin.id);
			for (const alias of plugin.aliases) {
				const owner = aliases.get(alias);
				if (owner !== undefined && owner !== plugin.id) {
					ctx.addIssue({
						code: "custom",
						message: `"${alias}" is an alias of both "${owner}" and "${plugin.id}"`,
					});
				}
				aliases.set(alias, plugin.id);
			}
		}
	});

/** The text of `texts` for `locale`, falling back to `en`. */
export function localizedText(
	texts: Readonly<Record<string, string>>,
	locale: string,
): string {
	return texts[locale] ?? (texts.en as string);
}
