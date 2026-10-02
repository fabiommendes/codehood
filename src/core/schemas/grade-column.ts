import { z } from "zod";
import { courseId, gradeColumnId, rev, slug, username } from "./base";
import { courseRef } from "./course";
import { enrollmentSchema } from "./enrollment";

export const gradeColumnKind = z.enum(["NUMBER", "LABEL"]);

/// One student's value in a grade column, as it leaves the service.
export const gradeValueSchema = z.object({
	username: username,
	/// A number on a `NUMBER` column, a string on a `LABEL` column.
	value: z.union([z.number(), z.string()]),
});

/// One student's value in a grade column, as a writer sends it.
export const gradeValueInput = z.object({
	username: username,
	value: z.union([z.number().finite(), z.string().trim().min(1).max(32)]),
});

export const gradeColumnSchema = z.object({
	id: gradeColumnId,
	courseId: courseId,
	slug: slug,
	title: z.string(),
	kind: gradeColumnKind,
	/// Order among the course's grade columns.
	position: z.number().int(),
	/// When students started seeing the column, or `null` while it is hidden.
	releasedAt: z.date().nullable(),
	rev: rev.nullable(),
	/// Ordered by username. A student reads their own value only.
	values: z.array(gradeValueSchema),
	createdAt: z.date(),
	updatedAt: z.date(),
});

// `releasedAt` is deliberately absent from every input: a column is released
// through the service's `release`, never by a write. Whether each value fits
// the column's `kind` is checked by the service, not by a refinement, because
// the REST API derives its body with `.omit()`.
export const gradeColumnCreate = gradeColumnSchema
	.omit({
		id: true,
		courseId: true,
		releasedAt: true,
		createdAt: true,
		updatedAt: true,
	})
	.extend({
		course: courseRef,
		title: z.string().trim().min(1).max(80),
		rev: rev.nullish(),
		/// The column's complete set of values, at most one per student.
		values: z
			.array(gradeValueInput)
			.refine(
				(values) =>
					new Set(values.map((entry) => entry.username)).size === values.length,
				"A student has at most one value in a column.",
			),
	});

// `slug` and `course` are deliberately absent: `slug` is the sync natural
// key, and changing it is a delete plus a create (FR-SYNC-011).
export const gradeColumnUpdate = gradeColumnCreate
	.omit({ course: true, slug: true })
	.partial();

export const gradeColumnPK = z.union([
	z.object({ id: gradeColumnId }),
	z.object({ course: courseRef, slug: slug }),
]);

export const gradeColumnFilterBase = z.object({});

export const gradeColumnFilter = gradeColumnFilterBase.extend({
	course: courseRef,
});

/// What one student's result at one exam reads, as the grades table shows it.
export const gradeCellSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("total"), total: z.number() }),
	z.object({ kind: z.literal("pending") }),
	z.object({ kind: z.literal("in-progress") }),
	z.object({ kind: z.literal("missed") }),
	z.object({ kind: z.literal("empty") }),
]);

/// A course's exam results for every enrolled student, dropped ones included.
export const courseGradesSchema = z.object({
	/// The exams of the grades table, in its order.
	exams: z.array(
		z.object({
			slug: slug,
			title: z.string(),
			scheduledAt: z.date().nullable(),
		}),
	),
	/// The students, in the order of the grades table.
	students: z.array(
		enrollmentSchema
			.pick({
				username: true,
				name: true,
				email: true,
				schoolId: true,
				githubId: true,
				status: true,
			})
			.extend({
				/// One result per exam, by exam slug.
				results: z.record(z.string(), gradeCellSchema),
			}),
	),
});
