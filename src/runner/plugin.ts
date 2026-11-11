/**
 * What a runner plugin declares: one language of the code runner.
 *
 * A plugin is data only. It points at the modules of each environment (the
 * driver in the sandbox, the editor support in the app, an optional build
 * step in Node) by specifier, so importing the configuration that lists it
 * pulls none of that code. Specifiers starting with `./` are paths relative
 * to the project root; any other is a package specifier.
 */

import { z } from "zod";
import { languageId, runMode } from "./protocol";
import type { RuntimePackage } from "./sandbox/runtimes";

/// Version of this contract; a plugin declaring another is refused.
export const RUNNER_API_VERSION = 1;

/// Text by locale; `en` is the fallback, so it is required.
const localized = z
	.record(z.string(), z.string().min(1))
	.refine((texts) => Object.hasOwn(texts, "en"), {
		message: "needs an `en` text, the fallback of every locale",
	});

/// A module specifier: `./path/from/the/root.ts` or a package specifier.
const specifier = z.string().min(1);

const runtimePackage: z.ZodType<RuntimePackage> = z.object({
	pkg: z.string().min(1),
	version: z.string().min(1),
	files: z.record(z.string(), z.string()),
	wrap: z
		.record(
			z.string(),
			z.object({
				prefix: z.string().optional(),
				suffix: z.string().optional(),
			}),
		)
		.optional(),
	bundle: z.record(z.string(), z.array(z.string())).optional(),
});

/** Schema of a runner plugin. */
export const runnerPlugin = z
	.object({
		apiVersion: z.literal(RUNNER_API_VERSION),
		/// Language id the protocol carries. `fake` is reserved for tests.
		id: languageId.refine((id) => id !== "fake", {
			message: "`fake` is reserved",
		}),
		/// Tags of code blocks and `CODE` resources that run in this language,
		/// lowercase. The id is added when missing.
		aliases: z.array(z.string().regex(/^[a-z0-9+#._-]+$/)).default([]),
		/// Extension of the source files, without the dot.
		extension: z.string().regex(/^[a-z0-9]+$/),
		/// File name of a program with no name; `main.<extension>` when absent.
		defaultFilename: z.string().min(1).optional(),
		modes: z.array(runMode).min(1),
		defaultMode: runMode,
		/// Name shown in the widget.
		label: localized,
		notes: z
			.object({
				/// Shown next to Run when each Run starts the program over.
				restart: localized.optional(),
			})
			.prefault({}),
		/// Module whose default export implements `Driver`. Bundled into the
		/// sandbox, so it may import only the sandbox, the files next to it
		/// and `sandboxDependencies`.
		driver: specifier,
		/// Module whose default export returns the CodeMirror extension of the
		/// language. Runs on the app origin.
		editor: specifier.optional(),
		/// Grammar for the colors: a language bundled with Shiki, or a module
		/// whose default export is a TextMate grammar called `name`.
		grammar: z
			.union([
				z.object({ shiki: z.string().min(1) }),
				z.object({ module: specifier, name: z.string().min(1) }),
			])
			.optional(),
		/// Packages copied to `/runner/rt/<pkg>@<version>/`.
		runtimes: z.array(runtimePackage).default([]),
		/// Packages under `node_modules` the driver may import.
		sandboxDependencies: z.array(z.string().min(1)).default([]),
		/// Node module whose default export is a `BuildStep`.
		build: specifier.optional(),
	})
	.refine((plugin) => plugin.modes.includes(plugin.defaultMode), {
		message: "defaultMode must be one of modes",
		path: ["defaultMode"],
	})
	.transform((plugin) => ({
		...plugin,
		aliases: plugin.aliases.includes(plugin.id)
			? plugin.aliases
			: [plugin.id, ...plugin.aliases],
	}));

/** What a plugin module writes. */
export type RunnerPluginInput = z.input<typeof runnerPlugin>;

/** A validated plugin. */
export type RunnerPlugin = z.output<typeof runnerPlugin>;

/**
 * Validates a plugin and fills in its defaults.
 *
 * @throws {Error} naming the plugin and every invalid key.
 */
export function defineRunner(input: RunnerPluginInput): RunnerPlugin {
	const result = runnerPlugin.safeParse(input);
	if (!result.success) {
		throw new Error(
			`Invalid runner plugin "${input.id}":\n${z.prettifyError(result.error)}`,
		);
	}
	return result.data;
}

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

/** What a plugin's build step may use. */
export interface BuildContext {
	/// Project root, absolute.
	readonly root: string;
	/// A directory of its own that survives builds, for caches.
	readonly cacheDir: string;
	/// Writes `name` into the versioned bundle, next to the driver chunks.
	emit(name: string, data: string | Uint8Array): void;
}

/** Default export of a plugin's `build` module. */
export type BuildStep = (ctx: BuildContext) => Promise<void>;

/** The text of `texts` for `locale`, falling back to `en`. */
export function localizedText(
	texts: Readonly<Record<string, string>>,
	locale: string,
): string {
	return texts[locale] ?? (texts.en as string);
}
