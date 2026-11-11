/**
 * The instance configuration: what `codehood.config.ts` declares.
 *
 * Process settings and secrets (`ENVIRONMENT`, `DATABASE_URL`, `DEBUG`) stay
 * in the environment; everything that describes the instance lives here.
 * Some keys are baked into the build (see `BUILD_TIME_KEYS`): the server
 * reads them again at boot, but a changed value only takes effect everywhere
 * after a rebuild.
 */

import { z } from "zod";
import { runnerPlugins } from "../runner/plugin";
import { defaultRunners } from "../runner/plugins";

/// IANA time zone accepted by `Intl.DateTimeFormat`.
const timeZone = z.string().refine(
	(zone) => {
		try {
			new Intl.DateTimeFormat("en", { timeZone: zone });
			return true;
		} catch {
			return false;
		}
	},
	{ message: "not an IANA time zone" },
);

/// Absolute http(s) URL, reduced to its origin.
const httpOrigin = z
	.url({ protocol: /^https?$/, message: "not an http(s) URL" })
	.transform((url) => new URL(url).origin);

/// Regex source matched against a whole value; empty accepts anything.
const wholeMatchSource = z.string().refine(
	(source) => {
		try {
			new RegExp(source);
			return true;
		} catch {
			return false;
		}
	},
	{ message: "not a valid regex" },
);

/** Schema of `codehood.config.ts`. Every key has a default. */
export const codehoodConfig = z.object({
	instance: z
		.object({
			/// Address the instance is served at.
			publicUrl: httpOrigin.default("http://localhost:4321"),
			/// Interface language; one of the locales in `project.inlang`.
			locale: z.string().default("en"),
			/// Zone every instant is rendered in.
			timeZone: timeZone.default("America/Sao_Paulo"),
			/// Format of school ids at this institution, as a regex over the whole id.
			schoolIdPattern: wholeMatchSource.default(""),
		})
		.prefault({}),
	storage: z
		.object({
			/// Where resource blobs are written.
			resourceRoot: z.string().min(1).default("./storage/resources"),
			/// How a blob's per-attachment names point at its bytes. Accepts any
			/// string as input, so it may come from `env()`.
			attachmentLinkMode: z
				.string()
				.pipe(z.enum(["symlink", "hardlink", "copy"]))
				.default("symlink"),
			/// Upload quota per role, as a byte size (`1gb`, `200mb`).
			quota: z
				.object({
					instructor: z.string().default("1gb"),
					student: z.string().default("200mb"),
				})
				.prefault({}),
		})
		.prefault({}),
	runner: z
		.object({
			/// Origin of the code runner; null derives one in development and
			/// turns code execution off in production.
			origin: z.string().nullable().default(null),
			/// Languages the runner runs, one plugin each (`defineRunner`).
			languages: runnerPlugins.default(defaultRunners),
		})
		.prefault({}),
});

/** What a config file writes: every key optional. */
export type CodehoodConfigInput = z.input<typeof codehoodConfig>;

/** A validated configuration with every default applied. */
export type CodehoodConfig = z.output<typeof codehoodConfig>;

/// Keys fixed when the app is built. Listed for error messages and docs.
export const BUILD_TIME_KEYS = [
	"instance.publicUrl",
	"instance.locale",
	"instance.timeZone",
	"runner.origin",
	"runner.languages",
] as const;

/**
 * Validates a configuration and fills in the defaults.
 *
 * @throws {Error} listing every invalid key.
 */
export function defineConfig(input: CodehoodConfigInput): CodehoodConfig {
	const result = codehoodConfig.safeParse(input);
	if (!result.success) {
		throw new Error(
			`Invalid Codehood configuration:\n${z.prettifyError(result.error)}`,
		);
	}
	return result.data;
}

/**
 * Reads an environment variable, or `fallback` when it is unset or blank.
 *
 * A blank value counts as unset: a variable left empty in an environment
 * file is a mistake, not a deliberate empty string. Without a fallback, an
 * unset variable gives `undefined`, and the schema default applies.
 *
 * @example
 * resourceRoot: env("RESOURCE_ROOT", "./storage/resources"),
 */
export function env(name: string): string | undefined;
export function env(name: string, fallback: string): string;
export function env(name: string, fallback?: string): string | undefined {
	const value = process.env[name];
	return value === undefined || value.trim() === "" ? fallback : value;
}
