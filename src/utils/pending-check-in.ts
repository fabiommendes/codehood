import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { RollCallId } from "@/core/schemas";
import { rollCallId } from "@/core/schemas/base";

/// How long a signed check-in claim stays valid after it is made.
export const CLAIM_TTL_MS = 10 * 60 * 1000;

/// What a check-in claim carries: the roll call and the moment of the scan.
export interface CheckInClaim {
	rollCallId: RollCallId;
	claimedAt: Date;
}

/// The decoded payload of a claim, as it sits in the cookie.
const claimSchema = z.object({
	rollCallId,
	/// Epoch milliseconds.
	claimedAt: z.number().int(),
});

/// Base64url HMAC-SHA256 of `payload` under `key`.
function signature(payload: string, key: string): string {
	return createHmac("sha256", key).update(payload).digest("base64url");
}

/**
 * Signs a check-in claim into a cookie value that the server can verify later.
 *
 * The value is `payload.signature`, both parts in base64url. The signature
 * covers the encoded payload text.
 */
export function signClaim(claim: CheckInClaim, key: string): string {
	const json = JSON.stringify({
		rollCallId: claim.rollCallId,
		claimedAt: claim.claimedAt.getTime(),
	});
	const payload = Buffer.from(json, "utf8").toString("base64url");
	return `${payload}.${signature(payload, key)}`;
}

/**
 * Reads a cookie value back into its claim, or `null` when it is not valid at `now`.
 *
 * A cookie is invalid when its signature does not match `key`, when it is
 * malformed, or when `now` is at or past `claimedAt` plus `CLAIM_TTL_MS`.
 */
export function readClaim(
	cookie: string,
	key: string,
	now: Date,
): CheckInClaim | null {
	const parts = cookie.split(".");
	if (parts.length !== 2) return null;
	const [payload = "", given = ""] = parts;

	const expected = Buffer.from(signature(payload, key));
	const actual = Buffer.from(given);
	if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
		return null;
	}

	let decoded: unknown;
	try {
		decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
	} catch {
		return null;
	}
	const parsed = claimSchema.safeParse(decoded);
	if (!parsed.success) return null;

	const claimedAt = new Date(parsed.data.claimedAt);
	if (now.getTime() >= claimedAt.getTime() + CLAIM_TTL_MS) return null;
	return { rollCallId: parsed.data.rollCallId, claimedAt };
}
