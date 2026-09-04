import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { USERNAME_RE } from "@/utils/course-url";

// Must run before any schema calls .openapi(...) — every route file imports
// this module first, so this is the one place that needs to call it.
extendZodWithOpenApi(z);

// =============================================================================
//                              Branding
// =============================================================================
const userId = z.number().brand("UserId");
export type UserId = z.infer<typeof userId>;

const apiKeyId = z.number().brand("ApiKeyId");
export type ApiKeyId = z.infer<typeof apiKeyId>;

const courseId = z.number().brand("CourseId");
export type CourseId = z.infer<typeof courseId>;

const passphraseId = z.number().brand("PassphraseId");
export type PassphraseId = z.infer<typeof passphraseId>;

const inviteId = z.number().brand("InviteId");
export type InviteId = z.infer<typeof inviteId>;

const fileId = z.number().brand("FileId");
export type FileId = z.infer<typeof fileId>;

const sessionId = z.number().brand("SessionId");
export type SessionId = z.infer<typeof sessionId>;

const timeSlotId = z.number().brand("TimeSlotId");
export type TimeSlotId = z.infer<typeof timeSlotId>;

const resourceId = z.number().brand("ResourceId");
export type ResourceId = z.infer<typeof resourceId>;

const calendarEventId = z.number().brand("CalendarEventId");
export type CalendarEventId = z.infer<typeof calendarEventId>;

// =============================================================================
//                               Schemas
// =============================================================================

//
// User
//

/** A valid username, per {@link USERNAME_RE}. */
export const usernameSchema = z
	.string()
	.regex(USERNAME_RE, "Invalid username.");

/**
 * A login identifier: either an email or a username.
 *
 * Uses `.describe()` (plain Zod) rather than `.openapi()` here: this module's
 * `zod` import ends up in a different SSR chunk than `@/api/registry`, whose
 * `extendZodWithOpenApi(z)` only patches the `ZodType` prototype of *its own*
 * chunk's `zod` instance. Calling `.openapi()` on a schema built here throws
 * at runtime ("... .openapi is not a function"); `.describe()` is native Zod
 * and zod-to-openapi reads it as the field description regardless.
 */
export const loginSchema = z
	.union([z.email(), usernameSchema])
	.describe("The user's email or username.");

export const userSchema = z.object({
	id: userId,
	publicId: z.string().min(1),
	email: z.email(),
	name: z.string().min(1),
	username: z.string().min(1),
	role: z.enum(["STUDENT", "INSTRUCTOR", "ADMIN"]),
	githubId: z.string().optional(),
	schoolId: z.string().optional(),
	passwordHash: z.string(),
});
export const userCreate = userSchema
	.omit({
		id: true,
		githubId: true,
		schoolId: true,
		publicId: true,
		passwordHash: true,
	})
	.extend({
		password: z.string().min(1),
		githubId: z.string().optional(),
		schoolId: z.string().optional(),
	});
export const userUpdate = userSchema
	.pick({
		name: true,
		email: true,
		githubId: true,
		schoolId: true,
	})
	.partial()
	.strict();
export const userPK = z.union([
	z.object({ publicId: z.string() }),
	z.object({ id: userId }),
	z.object({ email: z.email() }),
	z.object({ username: z.string() }),
	z.object({ githubId: z.string() }),
	z.object({ schoolId: z.string() }),
	z.object({ login: z.string() }), // email or username
]);
export const userFilter = z.object({
	usernames: z.array(z.string()).optional(),
	take: z.number().int().min(1).max(100).optional(),
});

//
// ApiKey
//
export const apiKeySchema = z.object({
	id: apiKeyId,
	keyHash: z.string(),
	token: z.string().optional(),
	name: z.string().min(1),
	kind: z.enum(["CLI", "BOT"]),
	userId: userId,
	lastUsedAt: z.date().nullable(),
	createdAt: z.date(),
});
export const apiKeyCreate = apiKeySchema.pick({
	name: true,
	kind: true,
	userId: true,
});
export const apiKeyPK = z.object({ id: apiKeyId });
export const apiKeyFilter = z.object({ userId: userId });

//
// Discipline
//
export const disciplineSchema = z.object({
	slug: z.string().min(1),
	name: z.string().min(1),
	createdAt: z.date(),
});
export const disciplineCreate = disciplineSchema.pick({
	slug: true,
	name: true,
});
export const disciplineUpdate = disciplineSchema.pick({
	name: true,
});
export const disciplinePK = disciplineSchema.pick({
	slug: true,
});
export const disciplineFilter = z.object({
	slugs: z.array(z.string()).optional(),
});

//
// Edition
//
export const editionSchema = z.object({
	slug: z.string().min(1),
	name: z.string().min(1),
	startAt: z.coerce.date(),
	endAt: z.coerce.date(),
	createdAt: z.coerce.date(),
});
export const editionCreate = editionSchema.pick({
	slug: true,
	name: true,
	startAt: true,
	endAt: true,
});
export const editionUpdate = editionSchema
	.pick({
		name: true,
		startAt: true,
		endAt: true,
	})
	.partial();
export const editionPK = editionSchema.pick({
	slug: true,
});
export const editionFilter = z.object({
	slugs: z.array(z.string()).optional(),
	active: z.boolean().optional(),
});

//
// Course
//

// The nested shapes `courseSchema` embeds — one per relation in `courseInclude`.
const courseInstructor = userSchema.pick({
	id: true,
	publicId: true,
	username: true,
	name: true,
});
const courseEnrollment = z.object({
	userId: userId,
	createdAt: z.date(),
});
export const courseSchema = z.object({
	id: courseId,
	description: z.string().nullable(),
	disciplineSlug: z.string(),
	editionSlug: z.string(),
	instructorSlug: z.string(),
	startAt: z.date(),
	endAt: z.date(),
	createdAt: z.date(),
	updatedAt: z.date(),
	discipline: disciplineSchema,
	edition: editionSchema,
	instructor: courseInstructor,
	enrollments: z.array(courseEnrollment),
	_count: z.object({ enrollments: z.number() }),
});
export const courseCreate = z.object({
	disciplineSlug: z.string().min(1),
	// The instructor's `username`, not a numeric id — `Course.instructor` targets `User.username`.
	instructorUsername: z.string().min(1),
	editionSlug: z.string().min(1),
	description: z.string().optional(),
	startAt: z.coerce.date(),
	endAt: z.coerce.date(),
});
export const courseUpdate = z.object({
	description: z.string().optional(),
	startAt: z.coerce.date().optional(),
	endAt: z.coerce.date().optional(),
});

// Identifies a course the way its URL does — see `src/utils/course-url.ts`.
export const courseRef = z.object({
	disciplineSlug: z.string(),
	username: z.string(),
	edition: z.string(),
});

// `id` is a plain number, not the branded `courseId`: callers source it from
// places that never carry the brand (coerced action input, another entity's
// foreign key), the same reasoning as `apiKeyService.revoke`'s `id`.
export const coursePK = z.union([
	z.object({ id: z.number() }),
	z.object({ ref: courseRef }),
]);
export const courseFilter = z.object({
	instructorUsername: z.string().optional(),
	disciplineSlug: z.string().optional(),
	editionSlug: z.string().optional(),
});
export const courseEnrollInput = z.object({
	courseId: z.number(),
	userId: z.number(),
});

//
// Passphrase
//
export const passphraseSchema = z.object({
	id: passphraseId,
	courseId: courseId,
	value: z.string().min(1),
	expiresAt: z.date(),
	createdAt: z.date(),
});

export const passphraseCreate = z.object({
	// `id`/`courseId` are plain numbers here, not the branded ids above:
	// this is sourced from a coerced action input, which never carries the
	// brand — the same reasoning as `coursePK`/`courseEnrollInput`.
	courseId: z.number(),
	// Overrides the auto-generated value. Stored verbatim — no format is enforced.
	value: z.string().min(1).optional(),
});

export const passphraseUpdate = z.object({
	expiresAt: z.date(),
});

export const passphrasePK = z.union([
	z.object({ id: z.number() }),
	z.object({ value: z.string() }),
]);

export const passphraseFilter = z.object({
	courseId: z.number().optional(),
	// Only passphrases whose `expiresAt` is still in the future.
	active: z.boolean().optional(),
});

//
// Invite
//

// The base row shape — what `create()` returns with no `include`.
export const inviteSchema = z.object({
	id: inviteId,
	tokenHash: z.string(),
	kind: z.enum(["PERSONAL", "CLASSROOM"]),
	email: z.string().nullable(),
	role: userSchema.shape.role,
	courseId: courseId.nullable(),
	maxUses: z.number().nullable(),
	expiresAt: z.date(),
	createdById: userId,
	createdAt: z.date(),
});

// What `findOne`/`update` return: the row plus its redemption count.
export const inviteWithCount = inviteSchema.extend({
	_count: z.object({ redemptions: z.number() }),
});

// What `findMany` returns: the above, plus who created it.
export const inviteListItem = inviteWithCount.extend({
	createdBy: z.object({ username: z.string(), name: z.string() }),
});

export const inviteCreate = z.object({
	kind: inviteSchema.shape.kind,
	email: z.string().optional(),
	role: userSchema.shape.role.optional(),
	// Plain number, not the branded `courseId`/`userId` above: sourced from
	// a coerced action input, the same reasoning as `coursePK`.
	courseId: z.number().optional(),
	maxUses: z.number().nullable().optional(),
	createdById: z.number(),
	expiresInMs: z.number().optional(),
});

export const inviteCreateResult = z.object({
	token: z.string(),
	invite: inviteSchema,
});

// `findOne` looks up by token — the credential itself, not a database id.
export const inviteTokenFilter = z.object({ token: z.string().min(1) });

// `update`/`delete` key on the numeric id, sourced from a coerced action
// input — plain, not the branded `inviteId`.
export const invitePK = z.object({ id: z.number() });

export const inviteFilter = z.object({
	createdById: z.number().optional(),
	kind: inviteSchema.shape.kind.optional(),
	courseId: z.number().optional(),
	// Only invites that have not expired yet.
	active: z.boolean().optional(),
});

export const inviteUpdate = z.object({
	expiresAt: z.date().optional(),
	maxUses: z.number().nullable().optional(),
});

//
// File
//
export const fileSchema = z.object({
	id: fileId,
	slugHash: z.string(),
	mimeType: z.string().min(1),
	size: z.number(),
	deletedAt: z.date().nullable(),
	createdAt: z.date(),
});

export const fileCreate = z.object({
	bytes: z
		.instanceof(Buffer)
		.openapi("Buffer", { type: "string", format: "binary" }),
	mimeType: z.string().min(1),
	// A hash the writer computed locally, checked against the hash the
	// server computes from `bytes`. A mismatch means the upload is corrupt.
	contentHash: z.string().optional(),
});

export const fileUpdate = z.object({
	mimeType: z.string().min(1),
});

export const filePK = z.union([
	z.object({ id: fileId }),
	z.object({ slugHash: z.string() }),
]);

export const fileFilter = z.object({
	ids: z.array(fileId).optional(),
	slugHashes: z.array(z.string()).optional(),
});

//
// Session
//
export const sessionSchema = z.object({
	id: sessionId,
	tokenHash: z.string(),
	userId: userId,
	expiresAt: z.date(),
	createdAt: z.date(),
});

export const sessionCreate = z.object({
	// Plain number, not the branded `userId`: sourced from `actor.id`, which
	// is already assignable, or a coerced action input elsewhere.
	userId: z.number(),
});

export const sessionCreateResult = z.object({
	token: z.string(),
	session: sessionSchema,
});

// A `token` deletion needs no further check (holding it is proof of
// ownership); a `userId` deletion ("log out everywhere") is actor-gated in
// the service. Plain number, same reasoning as `sessionCreate.userId`.
export const sessionDeletePK = z.union([
	z.object({ token: z.string().min(1) }),
	z.object({ userId: z.number() }),
]);

//
// TimeSlot
//
export const weekdaySchema = z.enum([
	"SUNDAY",
	"MONDAY",
	"TUESDAY",
	"WEDNESDAY",
	"THURSDAY",
	"FRIDAY",
	"SATURDAY",
]);

export const timeSlotSchema = z.object({
	id: timeSlotId,
	courseId: courseId,
	// Authored, sync identity. Stable when the hour changes.
	slug: z.string().min(1),
	title: z.string().nullable(),
	day: weekdaySchema,
	// Minutes since 00:00 in the server zone, e.g. 14:30 -> 870.
	startMin: z.number().int(),
	durationMin: z.number().int(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

export const timeSlotCreate = z.object({
	courseId: z.number(),
	slug: z.string().min(1),
	title: z.string().optional(),
	day: weekdaySchema,
	startMin: z.number().int(),
	durationMin: z.number().int(),
});

// `slug` is deliberately absent: it is the sync natural key, and changing it
// is a delete plus a create (FR-SYNC-011).
export const timeSlotUpdate = z.object({
	title: z.string().nullable().optional(),
	day: weekdaySchema.optional(),
	startMin: z.number().int().optional(),
	durationMin: z.number().int().optional(),
});

export const timeSlotRef = z.object({
	courseId: z.number(),
	slug: z.string(),
});

export const timeSlotPK = z.union([
	z.object({ id: z.number() }),
	z.object({ ref: timeSlotRef }),
]);

export const timeSlotFilter = z.object({
	courseId: z.number().optional(),
});

//
// Resource
//
export const resourceTypeSchema = z.enum(["LINK", "FILE", "CODE", "MD"]);

export const resourceSchema = z.object({
	id: resourceId,
	type: resourceTypeSchema,
	courseId: courseId,
	// Natural key from the repository path — FR-SYNC-010.
	slug: z.string().min(1),
	title: z.string().min(1),
	description: z.string().nullable(),
	// Url, for LINK resources, content for MD and CODE resources. Null for FILE resources.
	data: z.string().nullable(),
	// Language, for CODE resources. Null for LINK, FILE and MD resources.
	extra: z.string().nullable(),
	fileId: fileId.nullable(),
	file: fileSchema.nullable(),
	// Supplied by the writer, opaque to the server.
	contentHash: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

export const resourceCreate = z.object({
	courseId: z.number(),
	slug: z.string().min(1),
	type: resourceTypeSchema,
	title: z.string().min(1),
	description: z.string().optional(),
	data: z.string().optional(),
	extra: z.string().optional(),
	fileId: z.number().optional(),
	contentHash: z.string().min(1),
});

// `slug` is deliberately absent: it is the sync natural key, and renaming is
// a delete plus a create (FR-SYNC-011).
export const resourceUpdate = z.object({
	type: resourceTypeSchema.optional(),
	title: z.string().optional(),
	description: z.string().optional(),
	data: z.string().optional(),
	extra: z.string().optional(),
	fileId: z.number().optional(),
	contentHash: z.string().optional(),
});

export const resourceRef = z.object({
	courseId: z.number(),
	slug: z.string(),
});

export const resourcePK = z.union([
	z.object({ id: z.number() }),
	z.object({ ref: resourceRef }),
]);

export const resourceFilter = z.object({
	courseId: z.number().optional(),
	types: z.array(resourceTypeSchema).optional(),
	slugs: z.array(z.string()).optional(),
});

//
// CalendarEvent
//
export const eventKindSchema = z.enum([
	"LECTURE",
	"LAB",
	"EXAM",
	"REVIEW",
	"SEMINAR",
	"PROJECT",
	"SELF_STUDY",
	"HOLIDAY",
	"RECESS",
	"CANCELLED",
]);

// The linked exam's public summary — never the full `Exam` row, and never
// present at all unless {@link maskExam} decides `actor` may see it.
export const linkedExamSchema = z.object({
	id: z.number(),
	slug: z.string(),
	title: z.string(),
});

export const calendarEventSchema = z.object({
	id: calendarEventId,
	courseId: courseId,
	timeSlotId: timeSlotId,
	// Natural key from the repository path — FR-SYNC-010.
	slug: z.string().min(1),
	startAt: z.date(),
	durationMin: z.number().int(),
	// Authored, never derived (FR-CAL-015).
	week: z.number().int(),
	kind: eventKindSchema,
	title: z.string().min(1),
	description: z.string().nullable(),
	// Derived, never authored: the exam whose window overlaps this one.
	examId: z.number().nullable(),
	// Supplied by the writer, opaque to the server. See the manifest decision.
	contentHash: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	timeSlot: timeSlotSchema,
	exam: linkedExamSchema.nullable(),
});

export const calendarEventCreate = z.object({
	courseId: z.number(),
	timeSlotId: z.number(),
	slug: z.string().min(1),
	// The calendar day this event happens, `YYYY-MM-DD`, in the server zone.
	date: z.string().min(1),
	// Minutes since 00:00; defaults to the slot's `startMin` when omitted.
	startMin: z.number().int().optional(),
	// Defaults to the slot's `durationMin` when omitted.
	durationMin: z.number().int().optional(),
	week: z.number().int(),
	kind: eventKindSchema.optional(),
	title: z.string().min(1),
	description: z.string().optional(),
	contentHash: z.string().min(1),
});

// `slug`, `courseId`, and `timeSlotId` are deliberately absent: moving an
// event to a different slot is a delete plus a create. Provide `date` to
// move the event's day; `startMin`/`durationMin` without `date` is rejected,
// since a wall-clock move always names the day it lands on.
export const calendarEventUpdate = z.object({
	date: z.string().optional(),
	startMin: z.number().int().optional(),
	durationMin: z.number().int().optional(),
	week: z.number().int().optional(),
	kind: eventKindSchema.optional(),
	title: z.string().optional(),
	description: z.string().optional(),
	contentHash: z.string().optional(),
});

export const calendarEventRef = z.object({
	courseId: z.number(),
	slug: z.string(),
});

export const calendarEventPK = z.union([
	z.object({ id: z.number() }),
	z.object({ ref: calendarEventRef }),
]);

export const calendarEventFilter = z.object({
	courseIds: z.array(z.number()).optional(),
	// Inclusive: events whose window ends at or after it.
	from: z.date().optional(),
	// Exclusive: events starting before it.
	to: z.date().optional(),
	kinds: z.array(eventKindSchema).optional(),
	weeks: z.array(z.number().int()).optional(),
	// For "the next three meetings" on the course page.
	limit: z.number().int().positive().optional(),
});
