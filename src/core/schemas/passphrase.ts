import { z } from "zod";
import { courseId, passphraseId } from "./base";

export const passphraseSchema = z.object({
	id: passphraseId,
	courseId: courseId,
	value: z.string().min(1),
	expiresAt: z.date(),
	createdAt: z.date(),
});

export const passphraseCreate = z.object({
	// `id`/`courseId` are plain numbers here, not the branded ids above:
	// this is sourced from a coerced action input, which never carries the
	// brand — the same reasoning as `coursePK`/`courseEnrollInput`.
	courseId: z.number(),
	// Overrides the auto-generated value. Stored verbatim — no format is enforced.
	value: z.string().min(1).optional(),
});

export const passphraseUpdate = z.object({
	expiresAt: z.date(),
});

export const passphrasePK = z.union([
	z.object({ id: passphraseId }),
	z.object({ value: z.string() }),
]);

export const passphraseFilter = z.object({
	courseId: z.number().optional(),
	// Only passphrases whose `expiresAt` is still in the future.
	active: z.boolean().optional(),
});
