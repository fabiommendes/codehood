/**
 * Environment variables and configuration constants for the application.
 */

import type { Role } from "@/db/client";
import type { ArrayToUnion } from "@/typing";
import { parseByteSize } from "@/utils/format-bytes";

/**
 * Read environment variable as string with a default value.
 */
function readEnv(name: string, defaultValue: string): string {
	const value = process.env[name];
	if (value === undefined) {
		if (defaultValue !== undefined) {
			return defaultValue;
		}
		throw new Error(`Environment variable ${name} is not defined`);
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
): ArrayToUnion<T> {
	if (!elems.includes(value as T[number])) {
		throw new Error(`Invalid value: ${value}`);
	}
	return value as T[number];
}

// =============================================================================
//  						  ENVIRONMENT
// =============================================================================
export const DEBUG = readBoolean("DEBUG", false);
export const ENVIRONMENT = assertIn(readEnv("ENVIRONMENT", "dev"), [
	"dev",
	"prod",
]);
export const DEVELOPMENT = ENVIRONMENT === "dev";
export const PRODUCTION = ENVIRONMENT === "prod";

// =============================================================================
//  						    SESSION
// =============================================================================
export const SESSION_COOKIE = "session";
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
 * Log environment variables to the console for debugging purposes.
 */
function logEnvVariables(vars: [string, unknown][]): void {
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
