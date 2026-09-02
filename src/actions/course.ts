import { defineAction } from "astro:actions";
import { z } from "astro/zod";
import { requireUser } from "@/auth/require-user";
import { courseService } from "@/db/course.service";
import { passphraseService } from "@/db/passphrase.service";
import { withActionErrors, withServiceErrors } from "./helpers";

export const course = {
	/**
	 * Drops `userId`'s enrollment, defaulting to the caller — the one action
	 * behind both the instructor's "Drop" control on the Students tab and a
	 * student's own "Leave course" button, gated by `canDropEnrollment` inside
	 * `courseService.unenroll` (see dev/specs/to-do/course-navigation.md).
	 */
	dropEnrollment: defineAction({
		accept: "form",
		input: z.object({
			courseId: z.coerce.number().int(),
			userId: z.coerce.number().int().optional(),
		}),
		handler: withActionErrors(async (input, context) => {
			const actor = requireUser(context);
			await courseService.unenroll(
				{ courseId: input.courseId, userId: input.userId ?? actor.id },
				{ actor },
			);
		}),
	}),

	/**
	 * Generates a passphrase for the Manage tab's Enrollment panel — an
	 * auto-generated code unless the instructor overrides it, live for 5
	 * minutes (`PassphraseService`). There is no follow-up action: it is shown
	 * once and expires on its own, the same way a generated invite link is
	 * shown once and revoked rather than edited.
	 */
	generatePassphrase: defineAction({
		accept: "form",
		input: z.object({
			courseId: z.coerce.number().int(),
			value: z.string().trim().min(1).optional(),
		}),
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			return passphraseService.create(
				{ courseId: input.courseId, value: input.value },
				{ actor },
			);
		}),
	}),
};
