/**
 * Register all the API routes here.
 *
 * API routes should be thin layers over service classes. Thats why everything
 * should fit nicely in this module.
 */

import { z } from "zod";
import { SESSION_COOKIE } from "@/core/constants";
import { NotFound } from "@/core/error";
import * as schema from "@/core/schemas";
import { db } from "@/db";
import { parseCourseParams } from "@/urls";
import { CRUD, GET, PATCH, POST } from "./registry";
import { parseWeekParam } from "./utils";

export const apiKeyApi = CRUD("/api/api-key", {
	name: "Api Key",
	plural: "Api Keys",
	keySegment: "/[publicId]",
	// The raw id never leaves the server, and the hash is the stored credential.
	entity: schema.apiKeySchema.omit({ id: true, keyHash: true }),
	create: schema.apiKeyCreate,
	update: null,
	filter: schema.apiKeyFilter,
	key: schema.apiKeyPK,
	tags: ["Api Keys"],
	service: db.apiKey,
});

const courseScope = z.object({ course: schema.courseRef });

export const calendarEventApi = CRUD(
	"/api/course/[discipline]/[course]/calendar-event",
	{
		name: "Calendar Event",
		plural: "Calendar Events",
		keySegment: "/[week]/[timeSlot]",

		// The ids are the service's business: over the API an event is the
		// `(course, week, time slot)` it occupies, and its slot is a slug.
		entity: schema.calendarEventSchema
			.omit({ id: true, courseId: true })
			.extend({
				timeSlot: schema.timeSlotSchema.pick({
					slug: true,
					day: true,
					start: true,
					duration: true,
				}),
			}),
		create: schema.calendarEventCreateScoped,
		update: schema.calendarEventUpdate,
		filter: schema.calendarEventFilterBase,
		scope: courseScope,
		key: schema.calendarEventPK,

		tags: ["Calendar Events"],
		service: db.calendarEvent,

		parseKeyParams(params) {
			return {
				course: parseCourseParams(params),
				week: parseWeekParam(params.week as string),
				timeSlot: params.timeSlot as string,
			};
		},
		parseScopeParams: (params: Record<string, string>) => ({
			course: parseCourseParams(params),
		}),
	},
);

export const courseApi = CRUD("/api/course", {
	name: "Course",
	plural: "Courses",
	keySegment: "/[discipline]/[course]",
	parseKeyParams: parseCourseParams,
	entity: schema.courseSchema.omit({ id: true }),
	create: schema.courseCreate,
	update: schema.courseUpdate,
	filter: schema.courseFilter,
	key: schema.courseNaturalKey,
	tags: ["Courses"],
	service: db.course,
});

export const disciplinesApi = CRUD("/api/discipline", {
	name: "Discipline",
	plural: "Disciplines",
	keySegment: "/[slug]",
	entity: schema.disciplineSchema,
	create: schema.disciplineCreate,
	update: schema.disciplineUpdate,
	filter: schema.disciplineFilter,
	key: schema.disciplinePK,
	tags: ["Disciplines"],
	service: db.discipline,
});

export const editionApi = CRUD("/api/edition", {
	name: "Edition",
	plural: "Editions",
	keySegment: "/[slug]",
	entity: schema.editionSchema,
	create: schema.editionCreate,
	update: schema.editionUpdate,
	filter: schema.editionFilter,
	key: schema.editionPK,
	tags: ["Editions"],
	service: db.edition,
});

export const examApi = CRUD("/api/course/[discipline]/[course]/exam", {
	name: "Exam",
	plural: "Exams",
	keySegment: "/[slug]",

	entity: schema.examSchema.omit({ id: true }).extend({
		questions: z.array(schema.examQuestionSchema.omit({ id: true })),
	}),
	create: schema.examCreate.omit({ course: true }),
	update: schema.examUpdate,
	filter: schema.examFilterBase,
	scope: courseScope,
	key: schema.examPK,

	tags: ["Exams"],
	service: db.exam,

	parseKeyParams(params) {
		return { course: parseCourseParams(params), slug: params.slug as string };
	},
	parseScopeParams(params) {
		return { course: parseCourseParams(params) };
	},
});

export const inviteApi = CRUD("/api/invite", {
	name: "Invite",
	plural: "Invites",
	keySegment: "/[publicId]",
	entity: schema.inviteSchema.omit({ id: true, courseId: true }),
	create: schema.inviteCreate,
	update: null,
	filter: schema.inviteFilter,
	key: schema.invitePK,
	tags: ["Invites"],
	service: db.invite,
});

export const resourceApi = CRUD("/api/course/[discipline]/[course]/resource", {
	name: "Resource",
	plural: "Resources",
	keySegment: "/[slug]",

	entity: schema.resourceSchema.omit({ id: true, courseId: true }),
	create: schema.resourceCreate.omit({ course: true }),
	update: schema.resourceUpdate,
	filter: schema.resourceFilterBase,
	scope: courseScope,
	key: schema.resourcePK,

	tags: ["Resources"],
	service: db.resource,

	parseKeyParams(params) {
		return { course: parseCourseParams(params), slug: params.slug as string };
	},
	parseScopeParams(params) {
		return { course: parseCourseParams(params) };
	},
});

export const questionApi = CRUD("/api/course/[discipline]/[course]/question", {
	name: "Question",
	plural: "Questions",
	keySegment: "/[slug]",

	// `db.question` reads return either the full document or its public half
	// (`QuestionView`), so the API entity mirrors that union, minus `id`.
	entity: z.union([
		schema.questionSchema.omit({ id: true }),
		schema.questionPublicSchema.omit({ id: true }),
	]),
	create: schema.questionCreate.omit({ course: true }),
	update: schema.questionUpdate,
	filter: schema.questionFilterBase,
	scope: courseScope,
	key: schema.questionPK,
	findOneQuery: schema.questionFindOneQuery,

	tags: ["Questions"],
	service: db.question,

	parseKeyParams(params) {
		return { course: parseCourseParams(params), slug: params.slug as string };
	},
	parseScopeParams(params) {
		return { course: parseCourseParams(params) };
	},
});

// Nested inside a response's `submissions` array too, so both `responseApi`
// and `submitApi` reuse it — a raw id under an array is still a raw id.
const apiSubmissionEntity = schema.submissionSchema.omit({
	id: true,
	responseId: true,
	questionId: true,
});

const apiResponseEntity = schema.responseSchema
	.omit({ id: true, courseId: true, examId: true })
	.extend({ submissions: z.array(apiSubmissionEntity) });

export const responseApi = CRUD("/api/course/[discipline]/[course]/response", {
	name: "Response",
	plural: "Responses",
	keySegment: "/[publicId]",

	entity: apiResponseEntity,
	create: schema.responseCreate.omit({ course: true }),
	update: schema.responseUpdate,
	filter: schema.responseFilterBase,
	scope: courseScope,
	key: schema.responsePK,

	tags: ["Responses"],
	service: db.response,

	parseKeyParams(params) {
		return {
			publicId: params.publicId as string,
			course: parseCourseParams(params),
		};
	},
	parseScopeParams(params) {
		return { course: parseCourseParams(params) };
	},
});

// Over the API a response is only ever named by its `publicId`; the service
// itself still accepts `{ id }` too, e.g. from pages.
const submissionResponseRef = z.object({ publicId: schema.publicId });

export const submissionApi = CRUD(
	"/api/course/[discipline]/[course]/submission",
	{
		name: "Submission",
		plural: "Submissions",
		keySegment: "/[publicId]",

		entity: apiSubmissionEntity,
		create: schema.submissionCreate
			.omit({ course: true })
			.extend({ response: submissionResponseRef }),
		upsert: false,
		update: schema.submissionUpdate,
		filter: schema.submissionFilterBase.extend({
			response: submissionResponseRef.optional(),
		}),
		scope: courseScope,
		key: schema.submissionPK,

		tags: ["Submissions"],
		service: db.submission,

		parseKeyParams(params) {
			return {
				publicId: params.publicId as string,
				course: parseCourseParams(params),
			};
		},
		parseScopeParams(params) {
			return { course: parseCourseParams(params) };
		},
	},
);

/// The submission a feedback path is nested under, bound to the path's course.
function submissionInCourse(params: Record<string, string>) {
	return {
		publicId: params.publicId as string,
		course: parseCourseParams(params),
	};
}

/**
 * Nested under the submission it grades: a `ref` is only unique once the
 * submission is known, so `(submission, ref)` is addressed by the path rather
 * than by an opaque id.
 */
export const feedbackApi = CRUD(
	"/api/course/[discipline]/[course]/submission/[publicId]/feedback",
	{
		name: "Feedback",
		plural: "Feedback",
		keySegment: "/[ref]",

		entity: schema.feedbackSchema.omit({ id: true, submissionId: true }),
		// PUT addresses the collection, so the `ref` of the pass being written
		// travels in the body, same as it does on POST.
		create: schema.feedbackCreate.omit({ submission: true }),
		update: schema.feedbackUpdate,
		filter: schema.feedbackFilterBase.omit({ submission: true }),
		scope: courseScope,
		key: schema.feedbackPK,

		tags: ["Feedback"],
		service: db.feedback,

		parseKeyParams(params) {
			return {
				submission: submissionInCourse(params),
				ref: params.ref as string,
			};
		},
		parseCreateParams(params) {
			return { submission: submissionInCourse(params) };
		},
		parseListParams(params) {
			return {
				course: parseCourseParams(params),
				submission: submissionInCourse(params),
			};
		},
	},
);

export const submitApi = POST("/api/course/[discipline]/[course]/submit", {
	in: schema.responseSubmit.omit({ course: true }),
	out: apiResponseEntity,
	summary: "Answer a question",
	description:
		"Resolves the answer slot for the question — creating it when the student has not answered before — and appends one attempt to it. Returns the slot with every attempt it now holds.",
	operationId: "submit",
	tags: ["Responses"],
	handler: async ({ actor, body, params }) => {
		return db.response.submit(
			{ ...body, course: parseCourseParams(params) },
			{ actor },
		);
	},
});

// export const sessionApi = CRUD("/api/session", {
//     name: "Session",
//     entity: schema.sessionSchema,
//     create: schema.sessionCreate,
//     update: z.any(),
//     filter: z.any(),
//     filterPk: schema.sessionPK,
//     tags: ["Sessions"],
//     service: db.session,
// });

export const timeSlotApi = CRUD("/api/course/[discipline]/[course]/time-slot", {
	name: "TimeSlot",
	plural: "Time Slots",
	keySegment: "/[slug]",

	entity: schema.timeSlotSchema.omit({ id: true, courseId: true }),
	create: schema.timeSlotCreate.omit({ course: true }),
	update: schema.timeSlotUpdate,
	filter: schema.timeSlotFilterBase,
	scope: courseScope,
	key: schema.timeSlotPK,

	tags: ["Time Slots"],
	service: db.timeSlot,

	parseKeyParams(params) {
		return { course: parseCourseParams(params), slug: params.slug as string };
	},
	parseScopeParams(params) {
		return { course: parseCourseParams(params) };
	},
});

// TODO: document Errors
const userTags = ["Users"];
const userErrors = {
	// TODO: Define user-related errors here
};

export const userApi = {
	viewMe: GET("/api/user/me", {
		out: schema.userSchema.omit({ passwordHash: true }),
		summary: "View current user information",
		tags: userTags,
		errors: userErrors,
		handler: async (args) => {
			return db.user.findOne(
				{ username: args.actor.username },
				{ actor: args.actor },
			);
		},
	}),
	updateMe: PATCH("/api/user/me", {
		in: schema.userUpdate,
		out: schema.userSchema.omit({ passwordHash: true }),
		summary: "Update current user information",
		tags: userTags,
		errors: userErrors,
		handler: async (args) => {
			return db.user.update({ username: args.actor.username }, args.body, {
				actor: args.actor,
			});
		},
	}),
	changePassword: POST("/api/user/me/change-password", {
		in: schema.passwordChange.openapi("PasswordChangeRequest"),
		out: z.object({ success: z.boolean() }).openapi("PasswordChangeResponse"),
		summary: "Change the current user's password",
		description:
			"Requires the current password. Every session the user holds is revoked, so a browser client has to log in again; API keys are left alone.",
		operationId: "changePassword",
		tags: userTags,
		errors: userErrors,
		handler: async ({ actor, body, cookies }) => {
			const user = await db.user.findOne(
				{ username: actor.username },
				{ actor },
			);
			if (!user) throw new NotFound("user", { id: actor.username });

			await db.user.changePassword(user, body, { actor });
			cookies.delete(SESSION_COOKIE, { path: "/" });
			return { success: true };
		},
	}),
	...CRUD("/api/user", {
		name: "User",
		keySegment: "/[username]",
		entity: schema.userSchema.pick({ username: true, name: true }),
		create: schema.userCreate,
		update: schema.userUpdate,
		filter: schema.userFilter,
		key: schema.userPK,
		tags: userTags,
		service: db.user,
	}),
};
