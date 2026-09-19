import { z } from "zod";
import { courseId, username } from "./base";
import { courseNaturalKey } from "./course";
import { userSchema } from "./user";

export const enrollmentStatus = z.enum(["ACTIVE", "DROPPED"]);

/**
 * A student in a course, as the course's instructor sees them.
 */
export const enrollmentSchema = userSchema
	.pick({
		username: true,
		name: true,
		email: true,
		githubId: true,
		schoolId: true,
	})
	.extend({
		courseId: courseId,
		status: enrollmentStatus,
		enrolledAt: z.date(),
	});

export const enrollmentCreate = z.object({
	courseId: z.union([courseId, courseNaturalKey]),
	username: username,
});

// An enrollment is identified by its `(course, student)` pair.
export const enrollmentPK = enrollmentCreate;

export const enrollmentFilterBase = z.object({
	// Defaults to `ACTIVE` in the service.
	status: enrollmentStatus.optional(),
});

export const enrollmentFilter = z.union([
	enrollmentFilterBase.extend({ courseId: courseId }),
	enrollmentFilterBase.extend(courseNaturalKey.shape),
]);
