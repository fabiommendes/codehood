import { z } from "zod";
import { courseId, rev, slug, username } from "./base";
import { disciplineInfo } from "./discipline";
import { editionInfo } from "./edition";
import { userInfo } from "./user";

export const courseSchema = z.object({
	id: courseId,
	description: z.string().nullable(),
	discipline: disciplineInfo,
	edition: editionInfo,
	instructor: userInfo,
	/// Count of `ACTIVE` enrollments. The roster itself is never in this
	/// schema — `enrollmentService.findMany` is the only way to list
	/// classmates, and it enforces `enrollment.read`.
	enrollmentCount: z.number().int(),
	rev: rev.nullable(),

	// Dates
	startAt: z.date(),
	endAt: z.date(),
	createdAt: z.date(),
	updatedAt: z.date(),

	// The date the current user joined the course.
	// SYSTEM joins at course creation.
	joinedAt: z.date(),
});

// Derived from `courseSchema` so a new column shows up here instead of
// drifting: the related entities are named by slug on the way in, and
// `description` is nullish so a create can clear it.
export const courseCreate = courseSchema
	.omit({
		id: true,
		enrollmentCount: true,
		createdAt: true,
		updatedAt: true,
		joinedAt: true,
	})
	.extend({
		discipline: z.string().min(1).describe("Discipline slug"),
		instructor: z.string().min(1).optional().describe("Instructor username"),
		edition: z.string().min(1).describe("Edition slug"),
		description: z.string().nullish(),
		rev: rev.nullish(),
		startAt: z.coerce.date(),
		endAt: z.coerce.date(),
	});

export const courseUpdate = courseSchema
	.pick({
		description: true,
		startAt: true,
		endAt: true,
	})
	.extend({ rev: rev.nullish() })
	.partial();

/**
 * Simplified representation of a course to be embedded in other entities,
 * e.g. `Question.course`.
 */
export const courseInfo = z.object({
	id: courseId,
	discipline: disciplineInfo,
	edition: editionInfo,
	instructor: userInfo,
});

// Identifies a course the way its URL does — see `src/utils/course-url.ts`.
export const courseNaturalKey = z.object({
	discipline: z.string(),
	instructor: z.string(),
	edition: z.string(),
});

// `id` is a plain number, not the branded `courseId`: callers source it from
// places that never carry the brand (coerced action input, another entity's
// foreign key), the same reasoning as `apiKeyService.revoke`'s `id`.
export const coursePK = z.union([z.object({ id: courseId }), courseNaturalKey]);

/**
 * Refers to a course either by its numeric id or by its natural key.
 *
 * The one shape every course-scoped service input uses under `course`, in
 * create, upsert, filter and composite-key schemas alike.
 */
export const courseRef = z.union([courseId, courseNaturalKey]);
export type CourseRef = z.infer<typeof courseRef>;

export const courseFilter = z
	.object({
		instructor: username,
		discipline: slug,
		edition: slug,
	})
	.partial();
