import { z } from "zod";
import { m } from "@/i18n";
import { publicId, rowVersion, slug, username } from "./base";
import { courseRef } from "./course";
import { examParams } from "./exam";

/// The longest `reason` or `notes`, in characters after trimming.
export const ADJUSTMENT_TEXT_MAX = 2000;

/// What an adjustment does: `SET` replaces the exam total, `FACTOR` multiplies it (or one question's score), `OFFSET` adds to it.
export const examAdjustmentOp = z
	.enum(["SET", "FACTOR", "OFFSET"])
	.openapi({ example: "FACTOR" });

export type ExamAdjustmentOp = z.infer<typeof examAdjustmentOp>;

/// A signed decimal string, such as `"0"`, `"0.25"` or `"-0.1"`: no exponent, no comma, no padding.
export const adjustmentValue = z
	.string()
	.regex(
		/^(?:0|-?(?:0\.\d*[1-9]|[1-9]\d*(?:\.\d*[1-9])?))$/,
		m.forms_schema_adjustment_value_invalid(),
	)
	.openapi({ example: "0.5" });

/**
 * Why `value` cannot be the value of `op`, or `null` when it can.
 *
 * `SET` takes `[0, 1]`, `FACTOR` `[0, 2]` and `OFFSET` `[-1, 1]` without 0. On
 * a question only a `FACTOR` below 1 is allowed. `field` is where the error
 * belongs: `op` when the operation itself cannot be used, `value` otherwise.
 */
export function adjustmentValueError(
	op: ExamAdjustmentOp,
	value: string,
	onQuestion: boolean,
): { field: "op" | "value"; message: string } | null {
	if (!adjustmentValue.safeParse(value).success) {
		return {
			field: "value",
			message: m.forms_schema_adjustment_value_invalid(),
		};
	}
	const number = Number(value);
	if (onQuestion && op !== "FACTOR") {
		return { field: "op", message: m.forms_schema_adjustment_question_op() };
	}
	if (onQuestion && number >= 1) {
		return {
			field: "value",
			message: m.forms_schema_adjustment_question_factor(),
		};
	}
	if (op === "SET" && (number < 0 || number > 1)) {
		return { field: "value", message: m.forms_schema_adjustment_set_range() };
	}
	if (op === "FACTOR" && (number < 0 || number > 2)) {
		return {
			field: "value",
			message: m.forms_schema_adjustment_factor_range(),
		};
	}
	if (op === "OFFSET" && (number < -1 || number > 1 || number === 0)) {
		return {
			field: "value",
			message: m.forms_schema_adjustment_offset_range(),
		};
	}
	return null;
}

/// Reports on `ctx` the refusal of `adjustmentValueError`, when `op` and `value` are both present.
function refineValue(
	data: { op?: ExamAdjustmentOp; value?: string; question?: string },
	ctx: z.RefinementCtx,
): void {
	if (data.op === undefined || data.value === undefined) return;
	const error = adjustmentValueError(
		data.op,
		data.value,
		data.question !== undefined,
	);
	if (error) {
		ctx.addIssue({
			code: "custom",
			path: [error.field],
			message: error.message,
		});
	}
}

/// Moves the decimal point of a signed decimal string `places` to the right (to the left when negative), exactly.
function shiftDecimal(text: string, places: number): string {
	const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
	if (!match) return text;
	const [, sign = "", int = "", frac = ""] = match;
	const all = int + frac;
	const point = int.length + places;
	const whole = point <= 0 ? "0" : all.padEnd(point, "0").slice(0, point);
	const rest = point <= 0 ? "0".repeat(-point) + all : all.slice(point);
	const integer = whole.replace(/^0+(?=\d)/, "");
	const decimals = rest.replace(/0+$/, "");
	const shifted = decimals === "" ? integer : `${integer}.${decimals}`;
	return shifted === "0" ? "0" : sign + shifted;
}

/**
 * A form's percentage as the stored fraction: `"50"` is `"0.5"`, and a decimal comma counts as a point.
 *
 * Text that is not a number passes unchanged.
 */
export function percentToFraction(text: string): string {
	return shiftDecimal(text.trim().replace(",", "."), -2);
}

/** The stored fraction as a form's percentage: `"0.5"` is `"50"`. */
export function fractionToPercent(text: string): string {
	return shiftDecimal(text, 2);
}

/// A form's value: a percentage, stored as a fraction. Its range depends on the operation, so the whole form checks it.
const adjustmentValueInput = z
	.string()
	.transform(percentToFraction)
	.pipe(adjustmentValue);

/// Free text, trimmed, up to 2000 characters; an empty one becomes `null`.
export const adjustmentText = z
	.string()
	.trim()
	.max(
		ADJUSTMENT_TEXT_MAX,
		m.forms_schema_adjustment_text_max({ max: ADJUSTMENT_TEXT_MAX }),
	)
	.transform((text) => (text === "" ? null : text));

/**
 * An instructor's decision to replace, multiply or add to one student's score
 * on an exam, or to multiply the score of one of its questions, as the
 * course's instructor sees it.
 *
 * `question` is `null` when the adjustment hits the exam total. `value` is a
 * fraction of the exam total (see `adjustmentValueError`). A revoked
 * adjustment keeps its row, with `revokedAt` and `revokedBy` set.
 */
export const examAdjustmentSchema = z.object({
	id: z.number().int(),
	publicId: publicId,
	/// The adjusted attempt, by `publicId`.
	response: publicId,
	/// The exam, by slug.
	exam: slug,
	/// The student who made the attempt.
	author: username,
	question: slug.nullable(),
	op: examAdjustmentOp,
	value: z.string(),
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

/// The adjustment as the adjusted student sees it: the instructor-only fields are left out.
export const examAdjustmentPublicSchema = examAdjustmentSchema.omit({
	notes: true,
	createdBy: true,
	revokedBy: true,
});

/// The fields of `examAdjustmentCreate`, before the cross-field rules.
const examAdjustmentCreateShape = {
	course: courseRef,
	exam: slug,
	usernames: z
		.array(username)
		.min(1, m.forms_schema_adjustment_usernames_required()),
	question: slug.optional(),
	op: examAdjustmentOp,
	value: adjustmentValue,
	reason: adjustmentText.nullish(),
	notes: adjustmentText.nullish(),
};

/// Adjusts each of `usernames` on the exam, or on one of its questions.
export const examAdjustmentCreate = z
	.object(examAdjustmentCreateShape)
	.superRefine(refineValue);

/// `examAdjustmentCreate` without the course and exam, which a REST route takes from its URL.
export const examAdjustmentCreateBody = z
	.object(examAdjustmentCreateShape)
	.omit({ course: true, exam: true })
	.superRefine(refineValue);

/// A field left out keeps its value; `null` or an empty text clears `reason` and `notes`.
///
/// The service checks `op` and `value` against the row they change.
export const examAdjustmentUpdate = z.object({
	op: examAdjustmentOp.optional(),
	value: adjustmentValue.optional(),
	reason: adjustmentText.nullish(),
	notes: adjustmentText.nullish(),
});

export const examAdjustmentPK = z.object({
	course: courseRef,
	exam: slug,
	publicId: publicId,
});

/// Lists the active adjustments of a course, or of one exam or student; `revoked` adds the revoked ones.
export const examAdjustmentFilter = z.object({
	course: courseRef,
	exam: slug.optional(),
	author: username.optional(),
	revoked: z.boolean().default(false),
});

//
// Action inputs: URL segments of the exam page plus the form fields.
//

/// What the adjustment dialog of an exam page sends: `value` is a percentage (10 is 10%).
export const examAdjustmentCreateForm = examParams
	.extend({
		usernames: z
			.array(username)
			.min(1, m.forms_schema_adjustment_usernames_required()),
		question: slug.optional(),
		op: examAdjustmentOp,
		value: adjustmentValueInput,
		reason: adjustmentText.nullish(),
		notes: adjustmentText.nullish(),
	})
	.superRefine(refineValue);

/// Addresses one adjustment from an exam page, by its `publicId`.
export const examAdjustmentRef = examParams.extend({ adjustment: publicId });

/// What the edit form of an adjustment sends, with the version of the adjustment the page loaded.
///
/// The form always sends `reason` and `notes`, so an empty one is `null` and clears the field. `value` is a percentage.
export const examAdjustmentUpdateForm = examAdjustmentRef
	.extend({
		op: examAdjustmentOp.optional(),
		value: adjustmentValueInput.optional(),
		reason: adjustmentText.nullable(),
		notes: adjustmentText.nullable(),
		updatedAt: rowVersion,
	})
	.superRefine(refineValue);

/// What the revoke button of an adjustment sends, with the version of the adjustment the page loaded.
export const examAdjustmentRevokeForm = examAdjustmentRef.extend({
	updatedAt: rowVersion,
});
