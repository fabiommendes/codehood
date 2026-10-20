import { z } from "zod";
import { courseId, username } from "./base";
import { courseParams, courseRef } from "./course";
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
	course: courseRef,
	username: username,
});

// An enrollment is identified by its `(course, student)` pair.
export const enrollmentPK = enrollmentCreate;

export const enrollmentFilterBase = z.object({
	// Defaults to `ACTIVE` in the service.
	status: enrollmentStatus.optional(),
});

export const enrollmentFilter = enrollmentFilterBase.extend({
	course: courseRef,
});

/// Adds a student to a course by email or username.
export const enrollmentAdd = courseParams.extend({
	login: z
		.string()
		.trim()
		.min(1)
		.meta({
			form: { label: "Email or username", placeholder: "student@example.com" },
		}),
});

/// Drops a student from a course; `username` defaults to the caller.
export const enrollmentDrop = courseParams.extend({
	username: z.string().optional(),
});
