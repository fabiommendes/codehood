import { createHash } from "node:crypto";

const BLOB_HASH_RE = /^[0-9a-f]{64}$/;

/**
 * The hash every blob is addressed by, pinned as part of the CLI wire
 * contract (see `dev/specs/to-do/blob-attachments.md`, "Hashing").
 *
 * Lowercase-hex sha-256 of the raw bytes and nothing else: no filename, no
 * length prefix, no framing.
 */
export function hashBytes(bytes: Buffer): string {
	return createHash("sha256").update(bytes).digest("hex");
}

/** True when `hash` is a well-formed blob hash: 64 lowercase hex characters. */
export function isBlobHash(hash: string): boolean {
	return BLOB_HASH_RE.test(hash);
}
