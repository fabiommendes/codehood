/**
 * Environment variables and configuration constants for the application.
 */

import type { ArrayToUnion } from "./utils/types";

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

export const DEBUG = readBoolean("DEBUG", false);
export const ENVIRONMENT = assertIn(readEnv("ENVIRONMENT", "dev"), [
	"dev",
	"prod",
]);

/**
 * Where resource blobs are stored on disk, as `<RESOURCE_ROOT>/<hash[0:2]>/<hash>`
 * (see `dev/specs/to-do/resources.md`). Defaults to a folder next to the
 * SQLite database so a fresh dev checkout works with no extra setup; a real
 * deployment should point this at a persistent volume and have its reverse
 * proxy `try_files` that path before falling back to the app (FR-SYNC-013).
 */
export const RESOURCE_ROOT = readEnv("RESOURCE_ROOT", "./storage/resources");

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
]);
