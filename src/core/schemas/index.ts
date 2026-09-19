// Import schemas from here, not from the sub-modules. Order does not matter:
// every sub-module imports `./base`, which patches zod with `.openapi(...)`.

export * from "./api-key";
export * from "./attachment";
// Branded id schemas, `slug` and `buffer` stay internal to the sub-modules.
export {
	type ApiKeyId,
	type AttachmentId,
	type BlobId,
	type CalendarEventId,
	type CourseId,
	type ExamId,
	type InviteId,
	type MimeType,
	mimeType,
	type PassphraseId,
	type QuestionDataId,
	type QuestionRefId,
	type ResourceId,
	type SessionId,
	type Slug,
	type SlugHash,
	slugHash,
	type TimeSlotId,
	type UserId,
	username,
} from "./base";
export * from "./blob";
export * from "./calendar-event";
export * from "./course";
export * from "./discipline";
export * from "./edition";
export * from "./enrollment";
export * from "./invite";
export * from "./passphrase";
export * from "./question";
export * from "./resource";
export * from "./session";
export * from "./time-slot";
export * from "./user";
