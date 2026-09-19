import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { USERNAME_RE } from "@/urls";

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

export const inviteId = z.number().int().brand("InviteId");
export type InviteId = z.infer<typeof inviteId>;

export const passphraseId = z.number().int().brand("PassphraseId");
export type PassphraseId = z.infer<typeof passphraseId>;

export const questionRefId = z.number().int().brand("QuestionRefId");
export type QuestionRefId = z.infer<typeof questionRefId>;

export const questionDataId = z.number().int().brand("QuestionDataId");
export type QuestionDataId = z.infer<typeof questionDataId>;

export const resourceId = z.number().int().brand("ResourceId");
export type ResourceId = z.infer<typeof resourceId>;

export const sessionId = z.number().int().brand("SessionId");
export type SessionId = z.infer<typeof sessionId>;

export const timeSlotId = z.number().int().brand("TimeSlotId");
export type TimeSlotId = z.infer<typeof timeSlotId>;

// We do not brand since it is not likely to be confused with other numeric IDs.
// due to both its type (not an int) and name (not id).
export const username = z.string().regex(USERNAME_RE, "Invalid username.");
export type UserId = z.infer<typeof username>;

// =============================================================================
//                          Generic Primitives
// =============================================================================

// Flat, so a slug is always exactly one URL segment. The CLI normalizes
// repository paths into this form; the server still refuses anything else.
export const slug = z
	.string()
	.regex(
		/^[a-z0-9][a-z0-9._-]*$/,
		"Lowercase letters, digits, '.', '_' and '-', starting with a letter or digit.",
	);

export type Slug = z.infer<typeof slug>;

// TODO: validate with proper validator
export const slugHash = z.string().min(1);
export type SlugHash = z.infer<typeof slugHash>;

// TODO: validate with proper validator
export const mimeType = z.string().min(1);
export type MimeType = z.infer<typeof mimeType>;

export const buffer = z
	.instanceof(Buffer)
	.openapi({ type: "string", format: "binary" });
