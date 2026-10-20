import { z } from "zod";
import { courseId, passphraseId } from "./base";
import { courseParams, courseRef } from "./course";

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

/// What a student types to join a course with an in-class passphrase.
export const passphraseRedeem = z.object({
	value: z
		.string()
		.trim()
		.min(1)
		.meta({
			form: {
				label: "Course code",
				hint: "Your instructor shows the code in class.",
			},
		}),
});

/// Generates the live passphrase of a course, random unless `value` is given.
export const passphraseGenerate = courseParams.extend({
	value: z
		.string()
		.trim()
		.min(1)
		.optional()
		.meta({
			form: {
				label: "Custom passphrase",
				hint: "Leave blank for a random 6-character code.",
				placeholder: "Auto-generated",
			},
		}),
});
