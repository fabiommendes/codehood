import { z } from "zod";
import { m } from "@/i18n";
import {
	isNumberInRange,
	joinGroupPath,
	parseGroupPath,
} from "@/services/rubric";
import { slug } from "./base";
import { courseRef } from "./course";
import { score } from "./feedback";

/// Names an item within its rubric; also a URL segment.
export const rubricKey = z.string().trim().min(1).max(100);

/// A group path, normalized to its stored form.
export const rubricGroup = z
	.string()
	.refine(
		(text) => parseGroupPath(text) !== null,
		m.forms_schema_rubric_group(),
	)
	.transform((text) => joinGroupPath(parseGroupPath(text) as string[]));

/// Credit before any item applies, a number in `[0, 1]`.
export const rubricBase = score
	.refine((text) => isNumberInRange(text, 0, 1), m.forms_schema_rubric_base())
	.openapi({ example: "0" });

export const rubricItemSchema = z.object({
	key: rubricKey,
	/// Path of the group; `null` for an item on its own.
	group: z.string().nullable(),
	text: z.string(),
	/// Signed fraction of the question score.
	value: score,
	/// For the people who grade only.
	comment: z.string().nullable(),
	/// Shown to the student when the item applies to their answer.
	feedback: z.string().nullable(),
	position: z.number().int(),
	/// Set when the item was split; passes that applied it keep their score.
	retiredAt: z.date().nullable(),
	/// How many counting answers have the item in their current grade.
	uses: z.number().int(),
});

export const rubricSchema = z.object({
	base: rubricBase,
	/// The question version the rubric was copied from, `null` when it started empty.
	sourceVersion: z.string().nullable(),
	/// Whether this is the question's initial rubric, not yet copied to the exam.
	initial: z.boolean(),
	/// How many counting answers apply a retired item.
	review: z.number().int(),
	items: z.array(rubricItemSchema),
});

/// Addresses the rubric of one question in one exam.
export const rubricPK = z.object({
	course: courseRef,
	exam: slug,
	question: slug,
});

export const rubricItemPK = rubricPK.extend({ key: rubricKey });

export const rubricUpdate = z.object({ base: rubricBase });

export const rubricItemCreate = z.object({
	/// Generated as `i<n>` when absent.
	key: rubricKey.optional(),
	group: rubricGroup.nullish(),
	text: z.string().trim().min(1),
	value: score,
	comment: z.string().nullish(),
	feedback: z.string().nullish(),
});

/// The whole item under a key the caller chose, for an idempotent create or replace.
export const rubricItemPut = rubricItemCreate.omit({ key: true });

export const rubricItemUpdate = rubricItemCreate.omit({ key: true }).partial();

export const rubricSplit = z.object({
	/// A child without `group` goes under `<group>/<text>` of the item split.
	children: z.array(rubricItemCreate).min(1),
});

export const rubricRenameGroup = z.object({
	from: rubricGroup,
	to: rubricGroup,
});

export const rubricRenameResult = z.object({
	renamed: z.number().int(),
	warnings: z.array(z.string()),
});

/// A change to preview before writing it.
export const rubricChange = z.discriminatedUnion("op", [
	z.object({ op: z.literal("update"), data: rubricUpdate }),
	z.object({
		op: z.literal("updateItem"),
		key: rubricKey,
		data: rubricItemUpdate,
	}),
	z.object({ op: z.literal("deleteItem"), key: rubricKey }),
]);

/// How many grading passes a change moves and how many of them students already read.
export const rubricPreview = z.object({
	passes: z.number().int(),
	released: z.number().int(),
});
