import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { EDITION_RE, USERNAME_RE } from "@/urls";

// Must run before any schema calls .openapi(...) — every schema module imports
// this one first, so this is the one place that needs to call it.
extendZodWithOpenApi(z);

// =============================================================================
//                              Branding
// =============================================================================

export const apiKeyId = z.number().int().brand("ApiKeyId");
export type ApiKeyId = z.infer<typeof apiKeyId>;

export const attachmentId = z.number().int().brand("AttachmentId");
export type AttachmentId = z.infer<typeof attachmentId>;

export const blobId = z.number().int().brand("BlobId");
export type BlobId = z.infer<typeof blobId>;

export const calendarEventId = z.number().int().brand("CalendarEventId");
export type CalendarEventId = z.infer<typeof calendarEventId>;

export const courseId = z.number().int().brand("CourseId");
export type CourseId = z.infer<typeof courseId>;

export const examId = z.number().int().brand("ExamId");
export type ExamId = z.infer<typeof examId>;

export const feedbackId = z.number().int().brand("FeedbackId");
export type FeedbackId = z.infer<typeof feedbackId>;

export const inviteId = z.number().int().brand("InviteId");
export type InviteId = z.infer<typeof inviteId>;

export const passphraseId = z.number().int().brand("PassphraseId");
export type PassphraseId = z.infer<typeof passphraseId>;

export const questionRefId = z.number().int().brand("QuestionRefId");
export type QuestionRefId = z.infer<typeof questionRefId>;

export const questionDataId = z.number().int().brand("QuestionDataId");
export type QuestionDataId = z.infer<typeof questionDataId>;

export const responseId = z.number().int().brand("ResponseId");
export type ResponseId = z.infer<typeof responseId>;

export const submissionId = z.number().int().brand("SubmissionId");
export type SubmissionId = z.infer<typeof submissionId>;

export const resourceId = z.number().int().brand("ResourceId");
export type ResourceId = z.infer<typeof resourceId>;

export const sessionId = z.number().int().brand("SessionId");
export type SessionId = z.infer<typeof sessionId>;

export const timeSlotId = z.number().int().brand("TimeSlotId");
export type TimeSlotId = z.infer<typeof timeSlotId>;

// We do not brand since it is not likely to be confused with other numeric IDs.
// due to both its type (not an int) and name (not id).
export const username = z
	.string()
	.regex(USERNAME_RE, "Invalid username.")
	.openapi({ example: "ada" });
export type UserId = z.infer<typeof username>;

// =============================================================================
//                          Generic Primitives
// =============================================================================

/// Flat, so a slug is always exactly one URL segment. The CLI normalizes
/// repository paths into this form; the server still refuses anything else.
export const slug = z
	.string()
	.regex(
		/^[a-z0-9][a-z0-9._-]*$/,
		"Lowercase letters, digits, '.', '_' and '-', starting with a letter or digit.",
	)
	.openapi({ example: "intro-to-recursion" });
export type Slug = z.infer<typeof slug>;

/// An opaque random identifier, safe to place in a URL or hand to a client.
export const publicId = z
	.string()
	.regex(/^[A-Za-z0-9_-]+$/, "Invalid public id.")
	.openapi({ example: "k3Vx9QpL2a" });
export type PublicId = z.infer<typeof publicId>;

// TODO: validate with proper validator
export const slugHash = z.string().min(1);
export type SlugHash = z.infer<typeof slugHash>;

/// Revision marker supplied by the writer, opaque to the server. The CLI uses it
/// to tell whether the stored copy of an entity matches its local one.
export const rev = z.string().min(1);

// TODO: validate with proper validator
export const mimeType = z.string().min(1);
export type MimeType = z.infer<typeof mimeType>;

/// The edition slug identifier
export const editionSlug = z
	.string()
	.regex(EDITION_RE)
	.openapi({ example: "2026-1" });
export type EditionSlug = z.infer<typeof editionSlug>;

export const buffer = z
	.instanceof(Buffer)
	.openapi({ type: "string", format: "binary" });

/// A wall clock reading, hour and minute, both zero-indexed. Not an instant
/// and not a duration: see `src/utils/schedule-time.ts` for the conversions
/// to and from minutes-since-midnight.
export const clockTime = z.object({
	hour: z.number().int().min(0).max(23),
	minute: z.number().int().min(0).max(59),
});
export type ClockTime = z.infer<typeof clockTime>;

/// A length of time, not a point in one. Neither field is capped — a duration
/// of `{ minutes: 150 }` and one of `{ hours: 2, minutes: 30 }` are the same
/// length — and either may be left out, so `{ hours: 1 }` needs no `minutes: 0`.
export const duration = z.object({
	hours: z.number().int().min(0).optional(),
	minutes: z.number().int().min(0).optional(),
});
export type Duration = z.infer<typeof duration>;

/// Used to define natural keys for resources nested under courses
export const courseScope = z.object({
	discipline: z.string().min(1),
	instructor: username,
	edition: editionSlug,
});
export type CourseScope = z.infer<typeof courseScope>;
