import { z } from "zod";
import { courseId, slug, username } from "./base";
import { disciplineInfo } from "./discipline";
import { editionInfo } from "./edition";
import { userInfo } from "./user";

export const courseSchema = z.object({
	id: courseId,
	description: z.string().nullable(),
	discipline: disciplineInfo,
	edition: editionInfo,
	instructor: userInfo,
	enrollments: userInfo.array(),

	// Dates
	startAt: z.date(),
	endAt: z.date(),
	createdAt: z.date(),
	updatedAt: z.date(),

	// The date the current user joined the course.
	// SYSTEM joins at course creation.
	joinedAt: z.date(),
});

export const courseCreate = z.object({
	discipline: z.string().min(1).describe("Discipline slug"),
	instructor: z.string().min(1).optional().describe("Instructor username"),
	edition: z.string().min(1).describe("Edition slug"),
	description: z.string().nullish(),
	startAt: z.coerce.date(),
	endAt: z.coerce.date(),
});

export const courseUpsert = courseCreate;

export const courseUpdate = courseSchema
	.pick({
		description: true,
		startAt: true,
		endAt: true,
	})
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

export const courseFilter = z
	.object({
		instructor: username,
		discipline: slug,
		edition: slug,
	})
	.partial();
