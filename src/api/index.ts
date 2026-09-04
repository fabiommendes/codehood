/**
 * Register all the API routes here.
 *
 * API routes should be thin layers over service classes. Thats why everything
 * should fit nicely in this module.
 */

import { z } from "zod";
import * as schema from "@/core/schemas";
import { db } from "@/db";
import { CRUD } from "./registry";

//
// Pure RESTful interfaces. They expose only the classic CRUD operations.
//
// Some services have a few operations disabled at the type level.
//
export const apiKeyApi = CRUD("/api/api-key", {
	name: "ApiKey",
	entity: schema.apiKeySchema,
	create: schema.apiKeyCreate,
	update: z.any().openapi("ApiKeyUpdate"), // FIXME: it should be never, not any
	filter: schema.apiKeyFilter,
	filterPk: schema.apiKeyPK,
	tags: ["Api Key"],
	service: db.apiKey,
});
// `/api/calendar-event`, not `/api/calendar`: the path mirrors the entity, the
// same way `/api/api-key` and `/api/time-slot` do, and it is the name
// `hook.ts` injects into Astro. They disagreed before, so nothing served it.
export const calendarEventApi = CRUD("/api/calendar-event", {
	name: "CalendarEvent",
	entity: schema.calendarEventSchema,
	create: schema.calendarEventCreate,
	update: schema.calendarEventUpdate,
	filter: schema.calendarEventFilter,
	filterPk: schema.calendarEventPK,
	tags: ["Calendar Events"],
	service: db.calendarEvent,
});
export const courseApi = CRUD("/api/course", {
	name: "Course",
	entity: schema.courseSchema,
	create: schema.courseCreate,
	update: schema.courseUpdate,
	filter: schema.courseFilter,
	filterPk: schema.coursePK,
	tags: ["Courses"],
	service: db.course,
});
export const disciplinesApi = CRUD("/api/discipline", {
	pk: "slug",
	name: "Discipline",
	entity: schema.disciplineSchema,
	create: schema.disciplineCreate,
	update: schema.disciplineUpdate,
	filter: schema.disciplineFilter,
	filterPk: schema.disciplinePK,
	tags: ["Disciplines"],
	service: db.discipline,
});
export const editionApi = CRUD("/api/edition", {
	pk: "slug",
	name: "Edition",
	entity: schema.editionSchema,
	create: schema.editionCreate,
	update: schema.editionUpdate,
	filter: schema.editionFilter,
	filterPk: schema.editionPK,
	tags: ["Editions"],
	service: db.edition,
});
export const fileApi = CRUD("/api/file", {
	name: "File",
	entity: schema.fileSchema,
	create: schema.fileCreate,
	update: schema.fileUpdate,
	filter: schema.fileFilter,
	filterPk: schema.filePK,
	tags: ["Files"],
	service: db.file,
});
// export const inviteApi = CRUD("/api/invite", {
//     name: "Invite",
//     entity: schema.inviteSchema,
//     create: schema.inviteCreate,
//     update: schema.inviteUpdate,
//     filter: schema.inviteFilter,
//     filterPk: schema.invitePK,
//     tags: ["Invites"],
//     service: db.invite,
// });
export const resourceApi = CRUD("/api/resource", {
	name: "Resource",
	entity: schema.resourceSchema,
	create: schema.resourceCreate,
	update: schema.resourceUpdate,
	filter: schema.resourceFilter,
	filterPk: schema.resourcePK,
	tags: ["Resources"],
	service: db.resource,
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
	filterPk: schema.timeSlotPK,
	tags: ["Time Slots"],
	service: db.timeSlot,
});
export const userApi = CRUD("/api/user", {
	name: "User",
	entity: schema.userSchema,
	create: schema.userCreate,
	update: schema.userUpdate,
	filter: schema.userFilter,
	filterPk: schema.userPK,
	tags: ["Users"],
	service: db.user,
});
