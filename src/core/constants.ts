/**
 * Settings of the running instance, from the environment and
 * `codehood.config.ts`, and other configuration constants.
 */

import config from "codehood:config";
import { resolveRunnerOrigin } from "@codehood/runner/server/config";
import type { Role } from "@/db/client";
import type { ArrayToUnion } from "@/typing";
import { parseByteSize } from "@/utils/format-bytes";

/**
 * Reads an environment variable as a string, falling back to `defaultValue`.
 *
 * An empty or whitespace-only value counts as absent: a variable left blank
 * in a deployment's environment file is a mistake, not a deliberate empty
 * string, and silently accepting it is how a production switch ends up
 * reading as its development default. Without a `defaultValue`, an absent
 * variable throws instead.
 */
function readEnv(name: string, defaultValue?: string): string {
	const value = process.env[name];
	if (value === undefined || value.trim() === "") {
		if (defaultValue !== undefined) {
			return defaultValue;
		}
		throw new Error(
			`Environment variable ${name} is not defined. It has no default: ` +
				"set it explicitly (see the deployment section of README.md).",
		);
	}
	return value;
}

/**
 * Read a boolean environment variable with a boolean content.
 *
 * The function interprets the following values as true: "true", "1" (case
 * insensitive) and all other as false.
 */
function readBoolean(name: string, defaultValue?: boolean): boolean {
	const value = process.env[name];
	if (value === undefined) {
		if (defaultValue !== undefined) {
			return defaultValue;
		}
		throw new Error(`Environment variable ${name} is not defined`);
	}
	return value.toLowerCase() === "true" || value === "1";
}

/**
 * Verify that a string value is included in a list of allowed values. If the value is not included, an error is thrown.
 */
function assertIn<T extends E[], E extends string>(
	value: string,
	elems: T,
	name?: string,
): ArrayToUnion<T> {
	if (!elems.includes(value as T[number])) {
		const where = name ? `${name}: ` : "";
		throw new Error(
			`${where}invalid value "${value}". Expected one of: ${elems.join(", ")}.`,
		);
	}
	return value as T[number];
}

/**
 * Compiles `source` into a regex that must match a whole string, or `null` when it is empty.
 *
 * @throws {SyntaxError} When `source` is not a valid regex.
 */
function wholeMatch(source: string): RegExp | null {
	return source ? new RegExp(`^(?:${source})$`) : null;
}

/**
 * Normalize a validated `ENVIRONMENT` value to the short form the rest of the
 * codebase compares against.
 */
function normalizeEnvironment(
	value: "dev" | "development" | "prod" | "production",
): "dev" | "prod" {
	return value === "development" || value === "dev" ? "dev" : "prod";
}

// =============================================================================
//  						  ENVIRONMENT
// =============================================================================
export const DEBUG = readBoolean("DEBUG", false);
/// The single switch separating a development instance from a deployed one.
///
/// Deliberately has no default. It decides whether demo accounts may be
/// seeded and whether the session cookie carries `Secure`, so a deployment
/// that forgets it must fail to boot rather than quietly come up as `dev`.
///
/// Accepts the long spellings `development` and `production` as aliases for
/// `dev` and `prod`, normalized here so every other call site keeps comparing
/// against the short form.
export const ENVIRONMENT = normalizeEnvironment(
	assertIn(
		readEnv("ENVIRONMENT"),
		["dev", "development", "prod", "production"],
		"ENVIRONMENT",
	),
);
export const DEVELOPMENT = ENVIRONMENT === "dev";
export const PRODUCTION = ENVIRONMENT === "prod";

/// Public address of this instance, the origin of absolute URLs the server
/// hands out of a request context, such as a repository's clone URL. Also
/// read at build time by `astro.config.mjs`.
export const PUBLIC_URL = config.instance.publicUrl;

/// Origin the runner frame is served from, or null when code execution is off.
export const RUNNER_ORIGIN: string | null = resolveRunnerOrigin(
	config.runner.origin ?? undefined,
	PUBLIC_URL,
	ENVIRONMENT,
);

// =============================================================================
//  						    SESSION
// =============================================================================
/// `__Host-` requires `Secure`, which only exists in production (HTTP in dev and tests).
export const SESSION_COOKIE = PRODUCTION ? "__Host-session" : "session";

/// The attributes every session cookie is written with, wherever it is set.
///
/// The one definition in the project: `secure` follows `ENVIRONMENT` alone,
/// so a cookie cannot end up without it because a second call site consulted
/// a different variable.
export const SESSION_COOKIE_OPTIONS = {
	httpOnly: true,
	secure: PRODUCTION,
	sameSite: "lax" as const,
	path: "/",
};

// =============================================================================
//  							USERS
// =============================================================================

/// The format this institution gives school ids, as a regex matched against the
/// whole id (e.g. `[0-9]{9}`). Unset accepts any id the schema allows. An
/// invalid regex fails the boot.
export const SCHOOL_ID_PATTERN = wholeMatch(config.instance.schoolIdPattern);

// =============================================================================
//  							RESOURCES
// =============================================================================

/**
 * Where resource blobs are stored on disk.
 *
 * Defaults to a folder next to the SQLite database so a fresh dev checkout
 * works with no extra setup; a real deployment should point this at a persistent
 * volume and have its reverse proxy `try_files` that path before falling back
 * to the app, which answers for tombstoned blobs.
 */
export const RESOURCE_ROOT = config.storage.resourceRoot;

/**
 * How a blob's per-attachment names are materialised next to its bytes.
 *
 * `symlink` is self-documenting (`ls -l` resolves to the hash) but needs
 * symlink following, which hardened nginx turns off; `hardlink` works where
 * symlinks do not; `copy` exists for filesystems supporting neither, at the
 * cost of storing the bytes once per distinct filename.
 */
export const ATTACHMENT_LINK_MODE = config.storage.attachmentLinkMode;
export type AttachmentLinkMode = typeof ATTACHMENT_LINK_MODE;

/**
 * Total bytes each role may have attached, `null` for unlimited.
 *
 * Global for now; the schema supports per-account and per-course limits later
 * with no migration.
 */
export const BLOB_QUOTA_BY_ROLE: Record<Role, number | null> = {
	ADMIN: null,
	INSTRUCTOR: parseByteSize(config.storage.quota.instructor),
	STUDENT: parseByteSize(config.storage.quota.student),
};

/** How long an unattached blob survives before garbage collection may take it. */
export const BLOB_GC_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * How long a practice session stays open.
 *
 * A student who answers the same question again within the window continues
 * the session they were in; after it, they start a new one.
 */
export const PRACTICE_SESSION_WINDOW_MS = 12 * 60 * 60 * 1000;

/// Whether to echo the resolved environment at startup. Off unless asked for:
/// the lines are noise in a test run, where they interleave with the reporter.
const LOG_ENV = readBoolean("LOG_ENV", false);

/**
 * Log environment variables to the console for debugging purposes.
 */
function logEnvVariables(vars: [string, unknown][]): void {
	if (!LOG_ENV) return;
	for (const [name, value] of vars) {
		console.log(`[env] ${name}=${value}`);
	}
}

logEnvVariables([
	["DEBUG", DEBUG],
	["ENVIRONMENT", ENVIRONMENT],
	["instance.publicUrl", PUBLIC_URL],
	["runner.origin", RUNNER_ORIGIN],
	["storage.resourceRoot", RESOURCE_ROOT],
	["storage.attachmentLinkMode", ATTACHMENT_LINK_MODE],
	["storage.quota.instructor", BLOB_QUOTA_BY_ROLE.INSTRUCTOR],
	["storage.quota.student", BLOB_QUOTA_BY_ROLE.STUDENT],
	["instance.schoolIdPattern", SCHOOL_ID_PATTERN],
]);

/**
 * How long after an attempt's deadline the server still accepts an answer.
 *
 * It absorbs network latency, client retries and clock skew, so an answer typed
 * in time is not lost for being delivered a few seconds late. It is never shown
 * to students: their countdown still ends at the deadline.
 */
export const EXAM_ANSWER_GRACE_MS = 10_000;
