import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { EDITION_RE, USERNAME_RE } from "@/utils/course-url";

// Must run before any schema calls .openapi(...) — every route file imports
// this module first, so this is the one place that needs to call it.
extendZodWithOpenApi(z);

// =============================================================================
//                              Branding
// =============================================================================

const apiKeyId = z.number().int().brand("ApiKeyId");
export type ApiKeyId = z.infer<typeof apiKeyId>;

const calendarEventId = z.number().int().brand("CalendarEventId");
export type CalendarEventId = z.infer<typeof calendarEventId>;

const courseId = z.number().int().brand("CourseId");
export type CourseId = z.infer<typeof courseId>;

const examId = z.number().int().brand("ExamId");
export type ExamId = z.infer<typeof examId>;

const fileId = z.number().int().brand("FileId");
export type FileId = z.infer<typeof fileId>;

const inviteId = z.number().int().brand("InviteId");
export type InviteId = z.infer<typeof inviteId>;

const passphraseId = z.number().int().brand("PassphraseId");
export type PassphraseId = z.infer<typeof passphraseId>;

const resourceId = z.number().int().brand("ResourceId");
export type ResourceId = z.infer<typeof resourceId>;

const sessionId = z.number().int().brand("SessionId");
export type SessionId = z.infer<typeof sessionId>;

const timeSlotId = z.number().int().brand("TimeSlotId");
export type TimeSlotId = z.infer<typeof timeSlotId>;

// UserId is now the username.
// We do not brand since it is not likely to be confused with other numeric IDs.
// due to both its type (not an int) and name (not id).
const userId = z.string();
export type UserId = z.infer<typeof userId>;

// =============================================================================
//                               Schemas
// =============================================================================

//
// User
//

/**
 * A login identifier: either an email or a username.
 */
/** A valid username, per {@link USERNAME_RE}. */
export const username = z.string().regex(USERNAME_RE, "Invalid username.");

export const usernameOrEmail = z
	.union([z.email(), username])
	.describe("The user's email or username.");

const userRole = z.enum(["STUDENT", "INSTRUCTOR", "ADMIN"]);

export const userSchema = z.object({
	email: z.email(),
	name: z.string().min(1),
	username: z.string().min(1),
	role: userRole,

	// TODO: add validations for githubId and schoolId (e.g. regex, length)
	// schoolId should read the optional regex from a env variable.
	githubId: z.string().nullable(),
	schoolId: z.string().nullable(),
	passwordHash: z.string(),
	createdAt: z.date(),
});

// `username` is tightened here rather than on `userSchema`: a username is a
// path segment, so the format has to hold for anything the API creates, but
// `userSchema` is also the `returns:` schema on four service methods, and an
// output validator's job is the shape, not re-checking a value constraint
// already enforced on write. See docs/design/db-service-classes.md.
export const userCreate = userSchema
	.omit({ passwordHash: true, createdAt: true })
	.partial({ githubId: true, schoolId: true })
	.extend({
		password: z.string().min(1),
		username,
	});

/**
 * PUT-shaped input: `password` is optional and, when present on an existing
 * user, resets the stored one.
 */
export const userUpsert = userCreate.partial({ password: true });

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

/**
 * Simplified representation of a user in the system.
 *
 * Usually used embedded in other entities, e.g. `Course.instructor` or `ApiKey.createdBy`.
 */
const userInfo = userSchema.pick({
	name: true,
	username: true,
});

//
// ApiKey
//
export const apiKeySchema = z.object({
	id: apiKeyId,
	keyHash: z.string(),
	name: z.string().min(1),
	kind: z.enum(["CLI", "BOT"]),
	createdBy: userInfo,
	lastUsedAt: z.date().nullable(),
	createdAt: z.date(),

	/** Token is only shown in the `create` response. Undefined in all other cases. */
	token: z.string().optional(),
});
export const apiKeyCreate = apiKeySchema.pick({
	name: true,
	kind: true,
	createdBy: true,
});
export const apiKeyPK = z.object({ id: apiKeyId });
export const apiKeyFilter = z.object({ createdById: userId });

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

export const disciplineUpdate = disciplineSchema
	.pick({
		name: true,
	})
	.partial();

export const disciplineUpsert = disciplineCreate;

export const disciplinePK = disciplineSchema.pick({
	slug: true,
});

export const disciplineFilter = z.object({
	slugs: z.array(z.string()).optional(),
});

/**
 * Simplified representation of a discipline to be embedded in other entities,
 * e.g. `Course.discipline`.
 */
export const disciplineInfo = disciplineSchema.pick({ slug: true, name: true });

//
// Edition
//
export const editionSchema = z.object({
	slug: z.string().regex(EDITION_RE),
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

export const editionUpsert = editionCreate;

export const editionPK = editionSchema.pick({
	slug: true,
});

export const editionFilter = z.object({
	slugs: z.array(z.string()).optional(),
	active: z.boolean().optional(),
});

/**
 * Simplified representation of an edition to be embedded in other entities,
 * e.g. `Course.edition`.
 */
export const editionInfo = editionSchema.pick({ slug: true, name: true });

//
// Course
//

// The nested shapes `courseSchema` embeds — one per relation in `courseInclude`.
export const createCourseEnrollment = z.object({
	courseId: courseId,
	userId: userId,
});

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
	instructor: z.string().min(1).describe("Instructor username"),
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

// Identifies a course the way its URL does — see `src/utils/course-url.ts`.
export const courseRef = z.object({
	discipline: z.string(),
	instructor: z.string(),
	edition: z.string(),
});

// `id` is a plain number, not the branded `courseId`: callers source it from
// places that never carry the brand (coerced action input, another entity's
// foreign key), the same reasoning as `apiKeyService.revoke`'s `id`.
export const coursePK = z.union([
	z.object({ id: courseId }),
	z.object({ ref: courseRef }),
]);

// What the REST layer accepts, as opposed to what the service resolves. A
// course's address is `/api/course/<discipline>/<instructor>_<edition>`, so a
// route can only ever build the `ref` branch; keeping the union out of
// `filterPk` says that in the schema instead of in a comment.
export const coursePkRef = z.object({ ref: courseRef });

export const courseFilter = z.object({
	instructorUsername: z.string().optional(),
	disciplineSlug: z.string().optional(),
	editionSlug: z.string().optional(),
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
	z.object({ id: passphraseId }),
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
	invitedRole: userRole,
	courseId: courseId.nullable(),
	maxUses: z.number().int().nullable(),
	expiresAt: z.date(),
	redemptions: z.number().int(),
	createdBy: userInfo,
	createdAt: z.date(),

	// Only show once, when the invite is created
	token: z.string().optional(),
});

export const inviteCreate = inviteSchema
	.omit({
		id: true,
		tokenHash: true,
		expiresAt: true,
		createdAt: true,
		redemptions: true,
	})
	.extend({ expiresInMs: z.number().int().optional() });

export const inviteTokenFilter = z.object({ token: z.string().min(1) });
export const invitePK = z.object({ id: inviteId });

export const inviteFilter = z.object({
	createdById: userId.optional(),
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
// Blob and Attachment
//
export const blobHash = z
	.string()
	.regex(
		/^[0-9a-f]{64}$/,
		"Not a blob hash: expected 64 lowercase hex digits.",
	);

export const blobSchema = z.object({
	hash: blobHash,
	size: z.number(),
	deletedAt: z.date().nullable(),
	createdAt: z.date(),
});

export const blobCreate = z.object({
	bytes: z
		.instanceof(Buffer)
		.openapi("Buffer", { type: "string", format: "binary" }),
	// A hash the writer computed locally, checked against the hash the server
	// computes from `bytes`. A mismatch means the upload is corrupt.
	contentHash: blobHash.optional(),
});

export const blobPK = z.object({ hash: blobHash });

export const blobFilter = z.object({
	hashes: z.array(blobHash).optional(),
	unattached: z.boolean().optional(),
});

const attachmentId = z.number().int().brand("AttachmentId");
export type AttachmentId = z.infer<typeof attachmentId>;

export const attachmentOwnerSchema = z.enum(["RESOURCE", "QUESTION"]);

export const attachmentSchema = z.object({
	id: attachmentId,
	hash: blobHash,
	filename: z.string().min(1),
	mimeType: z.string().min(1),
	uploaderUsername: z.string().nullable(),
	ownerType: attachmentOwnerSchema,
	ownerId: z.number().int(),
	createdAt: z.date(),
});

export const attachmentCreate = z.object({
	bytes: z
		.instanceof(Buffer)
		.openapi("Buffer", { type: "string", format: "binary" }),
	filename: z.string().min(1),
	// Ignored when the filename carries a known extension, which wins.
	mimeType: z.string().min(1).nullish(),
	contentHash: blobHash.optional(),
	uploaderUsername: z.string().nullish(),
	ownerType: attachmentOwnerSchema,
	ownerId: z.number().int(),
});

export const attachmentUpdate = z.object({
	filename: z.string().min(1),
});

export const attachmentPK = z.object({ id: attachmentId });

export const attachmentFilter = z.object({
	ids: z.array(attachmentId).optional(),
	hashes: z.array(blobHash).optional(),
	ownerType: attachmentOwnerSchema.optional(),
	ownerIds: z.array(z.number().int()).optional(),
	uploaderUsername: z.string().optional(),
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
	userId: userId,
});

export const sessionCreateResult = z.object({
	token: z.string(),
	session: sessionSchema,
});

// A `token` deletion needs no further check (holding it is proof of
// ownership); a `userId` deletion ("log out everywhere") is actor-gated in
// the service.
export const sessionDeletePK = z.union([
	z.object({ token: z.string().min(1) }),
	z.object({ userId: userId }),
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
	courseId: courseId,
	slug: z.string().min(1),
	title: z.string().nullish(),
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

export const timeSlotUpsert = timeSlotCreate;

export const timeSlotRef = z.object({
	courseId: z.number(),
	slug: z.string(),
});

export const timeSlotPK = z.union([
	z.object({ id: timeSlotId }),
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

// Flat, so a slug is always exactly one URL segment. The CLI normalizes
// repository paths into this form; the server still refuses anything else.
const resourceSlug = z
	.string()
	.regex(
		/^[a-z0-9][a-z0-9._-]*$/,
		"Lowercase letters, digits, '.', '_' and '-', starting with a letter or digit.",
	);

// Exactly one of `courseId`/`courseRef` is required. The service checks it,
// not a refinement, because the REST API derives its body with `.omit()`.
export const resourceCreate = z.object({
	courseId: courseId.optional(),
	courseRef: courseRef.optional(),
	slug: resourceSlug,
	type: resourceTypeSchema,
	title: z.string().min(1),
	description: z.string().nullish(),
	data: z.string().nullish(),
	extra: z.string().nullish(),
	fileId: z.number().nullish(),
	contentHash: z.string().min(1),
});

export const resourceUpsert = resourceCreate;

// `slug` is deliberately absent: it is the sync natural key, and renaming is
// a delete plus a create (FR-SYNC-011).
export const resourceUpdate = z.object({
	type: resourceTypeSchema.optional(),
	title: z.string().optional(),
	description: z.string().nullish(),
	data: z.string().nullish(),
	extra: z.string().nullish(),
	fileId: z.number().nullish(),
	contentHash: z.string().optional(),
});

// Addressed under a course by id or by the course's own natural key. The REST
// API only ever builds the `courseRef` branch (FR-SYNC-010).
export const resourceRef = z.union([
	z.object({ courseId: z.number(), slug: resourceSlug }),
	z.object({ courseRef: courseRef, slug: resourceSlug }),
]);

export const resourcePK = z.union([
	z.object({ id: resourceId }),
	z.object({ ref: resourceRef }),
]);

// What the REST layer accepts, as opposed to what the service resolves: a
// resource's address is `/api/course/<discipline>/<instructor>_<edition>/resource/<slug>`.
export const resourcePkRef = z.object({
	ref: z.object({ courseRef: courseRef, slug: resourceSlug }),
});

export const resourceFilter = z.object({
	courseId: z.number().optional(),
	courseRef: courseRef.optional(),
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
	id: examId,
	slug: z.string(),
	title: z.string(),
});

export const calendarEventSchema = z.object({
	id: calendarEventId,
	courseId: courseId,
	timeSlotId: timeSlotId,
	examId: examId.nullable(),
	exam: linkedExamSchema.nullable(),

	// Natural key from the repository path — FR-SYNC-010.
	slug: z.string().min(1),
	startAt: z.date(),
	durationMin: z.number().int(),
	week: z.number().int(),

	kind: eventKindSchema,
	title: z.string().min(1),
	description: z.string().nullable(),

	// Supplied by the writer, opaque to the server.
	contentHash: z.string().min(1),
	createdAt: z.date(),
	updatedAt: z.date(),

	timeSlot: timeSlotSchema,
});

export const calendarEventCreate = calendarEventSchema
	.omit({
		id: true,
		createdAt: true,
		updatedAt: true,
		exam: true,
		// Computed by the service, not authored: `startAt` from `date` +
		// `startMin`, `examId` freshly from `examForEvent` on every write, and
		// `timeSlot` is never read from `create`'s input at all.
		startAt: true,
		examId: true,
		timeSlot: true,
	})
	.extend({
		// The calendar day this event happens, `YYYY-MM-DD`, in the server zone.
		date: z.string(),
		// Minutes since 00:00; defaults to the slot's `startMin` when omitted.
		startMin: z.number().int().optional(),
		// Defaults to the slot's `durationMin` when omitted.
		durationMin: z.number().int().optional(),
		// Defaults to the Prisma column default (`LECTURE`) when omitted.
		kind: eventKindSchema.optional(),
		description: z.string().nullable().optional(),
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
	description: z.string().nullish(),
	contentHash: z.string().optional(),
});

export const calendarEventUpsert = calendarEventCreate;

export const calendarEventRef = z.object({
	courseId: courseId,
	slug: z.string(),
});

export const calendarEventPK = z.union([
	z.object({ id: calendarEventId }),
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
