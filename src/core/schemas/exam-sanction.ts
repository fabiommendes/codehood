import { z } from "zod";
import { m } from "@/i18n";
import { publicId, rowVersion, slug, username } from "./base";
import { courseRef } from "./course";
import { examParams } from "./exam";

/// The longest `reason` or `notes`, in characters after trimming.
export const SANCTION_TEXT_MAX = 2000;

/// A multiplier on a score: a decimal string in `[0, 1)`, such as `"0"` or `"0.25"`.
export const sanctionFactor = z
	.string()
	.regex(/^0(\.\d+)?$/, m.forms_schema_sanction_factor_invalid())
	.openapi({ example: "0" });

/// A form's factor: like `sanctionFactor`, but a decimal comma counts as a point.
const sanctionFactorInput = z
	.string()
	.transform((text) => text.replace(",", "."))
	.pipe(sanctionFactor);

/// Free text, trimmed, up to 2000 characters; an empty one becomes `null`.
export const sanctionText = z
	.string()
	.trim()
	.max(
		SANCTION_TEXT_MAX,
		m.forms_schema_sanction_text_max({ max: SANCTION_TEXT_MAX }),
	)
	.transform((text) => (text === "" ? null : text));

/**
 * An instructor's decision to cancel or reduce one student's score on an exam,
 * or on one of its questions, as the course's instructor sees it.
 *
 * `question` is `null` when the sanction hits the exam total. A revoked
 * sanction keeps its row, with `revokedAt` and `revokedBy` set.
 */
export const examSanctionSchema = z.object({
	id: z.number().int(),
	publicId: publicId,
	/// The sanctioned attempt, by `publicId`.
	response: publicId,
	/// The exam, by slug.
	exam: slug,
	/// The student who made the attempt.
	author: username,
	question: slug.nullable(),
	factor: z.string(),
	/// Shown to the student.
	reason: z.string().nullable(),
	/// Instructor-only.
	notes: z.string().nullable(),
	createdBy: username,
	createdAt: z.date(),
	updatedAt: z.date(),
	revokedAt: z.date().nullable(),
	revokedBy: username.nullable(),
});

/// The sanction as the sanctioned student sees it: the instructor-only fields are left out.
export const examSanctionPublicSchema = examSanctionSchema.omit({
	notes: true,
	createdBy: true,
	revokedBy: true,
});

/// Sanctions each of `usernames` on the exam, or on one of its questions.
export const examSanctionCreate = z.object({
	course: courseRef,
	exam: slug,
	usernames: z
		.array(username)
		.min(1, m.forms_schema_sanction_usernames_required()),
	question: slug.optional(),
	factor: sanctionFactor.default("0"),
	reason: sanctionText.nullish(),
	notes: sanctionText.nullish(),
});

/// A field left out keeps its value; `null` or an empty text clears `reason` and `notes`.
export const examSanctionUpdate = z.object({
	factor: sanctionFactor.optional(),
	reason: sanctionText.nullish(),
	notes: sanctionText.nullish(),
});

export const examSanctionPK = z.object({
	course: courseRef,
	exam: slug,
	publicId: publicId,
});

/// Lists the active sanctions of a course, or of one exam or student; `revoked` adds the revoked ones.
export const examSanctionFilter = z.object({
	course: courseRef,
	exam: slug.optional(),
	author: username.optional(),
	revoked: z.boolean().default(false),
});

//
// Action inputs: URL segments of the exam page plus the form fields.
//

/// What the sanction dialog of an exam page sends.
export const examSanctionCreateForm = examParams.extend({
	usernames: examSanctionCreate.shape.usernames,
	question: examSanctionCreate.shape.question,
	factor: sanctionFactorInput.default("0"),
	reason: examSanctionCreate.shape.reason,
	notes: examSanctionCreate.shape.notes,
});

/// Addresses one sanction from an exam page, by its `publicId`.
export const examSanctionRef = examParams.extend({ sanction: publicId });

/// What the edit form of a sanction sends, with the version of the sanction the page loaded.
///
/// The form always sends `reason` and `notes`, so an empty one is `null` and clears the field.
export const examSanctionUpdateForm = examSanctionRef
	.extend(examSanctionUpdate.shape)
	.extend({
		factor: sanctionFactorInput.optional(),
		reason: sanctionText.nullable(),
		notes: sanctionText.nullable(),
		updatedAt: rowVersion,
	});

/// What the revoke button of a sanction sends, with the version of the sanction the page loaded.
export const examSanctionRevokeForm = examSanctionRef.extend({
	updatedAt: rowVersion,
});
