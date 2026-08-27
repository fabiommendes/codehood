import { createHash, randomBytes } from "node:crypto";

/**
 * A random URL-safe token, raw form shown to the user exactly once.
 */
export function generateToken(byteLength = 32): string {
	return randomBytes(byteLength).toString("base64url");
}

/**
 * Deterministic hash of a raw token, the only form persisted to the database.
 */
export function hashToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}
