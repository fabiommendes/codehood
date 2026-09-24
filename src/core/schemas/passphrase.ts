import { z } from "zod";
import { courseId, passphraseId } from "./base";
import { courseRef } from "./course";

export const passphraseSchema = z.object({
	id: passphraseId,
	courseId: courseId,
	value: z.string().min(1),
	expiresAt: z.date(),
	createdAt: z.date(),
});

export const passphraseCreate = z.object({
	course: courseRef,
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
	course: courseRef.optional(),
	// Only passphrases whose `expiresAt` is still in the future.
	active: z.boolean().optional(),
});
