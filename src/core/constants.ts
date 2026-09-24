/**
 * Environment variables and configuration constants for the application.
 */

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

// =============================================================================
//  						    SESSION
// =============================================================================
export const SESSION_COOKIE = "session";

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
//  							RESOURCES
// =============================================================================

/**
 * Where resource blobs are stored on disk.
 *
 * Defaults to a folder next to the SQLite database so a fresh dev checkout
 * works with no extra setup; a real deployment should point this at a persistent
 * volume and have its reverse proxy `try_files` that path before falling back
 * to the app (FR-SYNC-013).
 */
export const RESOURCE_ROOT = readEnv("RESOURCE_ROOT", "./storage/resources");

/**
 * How a blob's per-attachment names are materialised next to its bytes.
 *
 * `symlink` is self-documenting (`ls -l` resolves to the hash) but needs
 * symlink following, which hardened nginx turns off; `hardlink` works where
 * symlinks do not; `copy` exists for filesystems supporting neither, at the
 * cost of storing the bytes once per distinct filename.
 */
export const ATTACHMENT_LINK_MODE = assertIn(
	readEnv("ATTACHMENT_LINK_MODE", "symlink"),
	["symlink", "hardlink", "copy"],
);
export type AttachmentLinkMode = typeof ATTACHMENT_LINK_MODE;

/**
 * Total bytes each role may have attached, `null` for unlimited.
 *
 * Global for now; the schema supports per-account and per-course limits later
 * with no migration.
 */
export const BLOB_QUOTA_BY_ROLE: Record<Role, number | null> = {
	ADMIN: null,
	INSTRUCTOR: parseByteSize(readEnv("BLOB_QUOTA_INSTRUCTOR", "1gb")),
	STUDENT: parseByteSize(readEnv("BLOB_QUOTA_STUDENT", "200mb")),
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
	["RESOURCE_ROOT", RESOURCE_ROOT],
	["ATTACHMENT_LINK_MODE", ATTACHMENT_LINK_MODE],
	["BLOB_QUOTA_INSTRUCTOR", BLOB_QUOTA_BY_ROLE.INSTRUCTOR],
	["BLOB_QUOTA_STUDENT", BLOB_QUOTA_BY_ROLE.STUDENT],
]);
