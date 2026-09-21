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
import { CRUD, GET, PATCH, POST } from "./registry";
import { parseCourseParams } from "./utils";

export const calendarEventApi = CRUD("/api/calendar-event", {
	name: "Calendar Event",
	plural: "Calendar Events",
	entity: schema.calendarEventSchema,
	create: schema.calendarEventCreate,
	update: schema.calendarEventUpdate,
	filter: schema.calendarEventFilter,
	key: schema.calendarEventPK,
	tags: ["Calendar Events"],
	service: db.calendarEvent,
});

export const courseApi = CRUD("/api/course", {
	name: "Course",
	plural: "Courses",
	keySegment: "/[discipline]/[course]",
	parseKeyParams: parseCourseParams,
	entity: schema.courseSchema.omit({ id: true }),
	create: schema.courseCreate,
	update: schema.courseUpdate,
	upsert: schema.courseUpsert,
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

	entity: schema.examSchema,
	create: schema.examCreate.omit({ courseId: true }),
	upsert: schema.examUpsert.omit({ courseId: true }),
	update: schema.examUpdate,
	filter: schema.examFilterBase,
	scope: schema.courseNaturalKey,
	key: schema.examNaturalKey,

	tags: ["Exams"],
	service: db.exam,

	parseKeyParams(params) {
		return { ...parseCourseParams(params), slug: params.slug as string };
	},
	parseCreateParams(params) {
		return { courseId: parseCourseParams(params) };
	},
	parseListParams(params) {
		return parseCourseParams(params);
	},
});

export const inviteApi = CRUD("/api/invite", {
	name: "Invite",
	plural: "Invites",
	entity: schema.inviteSchema,
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

	entity: schema.resourceSchema.omit({ id: true }),
	create: schema.resourceCreate.omit({ courseId: true }),
	upsert: schema.resourceUpsert.omit({ courseId: true }),
	update: schema.resourceUpdate,
	filter: schema.resourceFilterBase,
	scope: schema.courseNaturalKey,
	key: schema.resourceNaturalKey,

	tags: ["Resources"],
	service: db.resource,

	parseKeyParams(params) {
		return { ...parseCourseParams(params), slug: params.slug as string };
	},
	parseCreateParams(params) {
		return { courseId: parseCourseParams(params) };
	},
	parseListParams(params) {
		return parseCourseParams(params);
	},
});

export const questionApi = CRUD("/api/course/[discipline]/[course]/question", {
	name: "Question",
	plural: "Questions",
	keySegment: "/[slug]",

	entity: schema.questionSchema,
	create: schema.questionCreate.omit({ courseId: true }),
	upsert: schema.questionUpsert.omit({ courseId: true }),
	update: schema.questionUpdate,
	filter: schema.questionFilterBase,
	scope: schema.courseNaturalKey,
	key: schema.questionNaturalKey,
	findOneQuery: schema.questionFindOneQuery,

	tags: ["Questions"],
	service: db.question,

	parseKeyParams(params) {
		return { ...parseCourseParams(params), slug: params.slug as string };
	},
	parseCreateParams(params) {
		return { courseId: parseCourseParams(params) };
	},
	parseListParams(params) {
		return parseCourseParams(params);
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

export const timeSlotApi = CRUD("/api/time-slot", {
	name: "TimeSlot",
	entity: schema.timeSlotSchema,
	create: schema.timeSlotCreate,
	update: schema.timeSlotUpdate,
	filter: schema.timeSlotFilter,
	key: schema.timeSlotPK,
	tags: ["Time Slots"],
	service: db.timeSlot,
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
