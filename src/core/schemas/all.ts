// Every schema in one namespace, for server code that registers or looks up
// schemas by name (`db.schema`, the REST and RPC registries). Client code must
// import the sub-module that defines what it needs: the schema modules run
// `.openapi(...)` at load, so nothing here tree-shakes.
// Order does not matter: every sub-module imports `./base`, which patches zod.

export * from "./answer";
export * from "./answer-edit";
export * from "./api-key";
export * from "./attachment";
// Branded id schemas, `slug` and `buffer` stay internal to the sub-modules.
export {
	type AnswerEditBatchId,
	type AnswerEditFieldId,
	type AnswerEditGapId,
	type AnswerEditHistoryId,
	type ApiKeyId,
	type AttachmentId,
	type BlobId,
	type CalendarEventId,
	type ClockTime,
	type CourseId,
	clockTime,
	type Duration,
	duration,
	type ExamExceptionId,
	type ExamId,
	type FeedbackId,
	type GradeColumnId,
	type InviteId,
	type IsoDate,
	isoDate,
	type MimeType,
	mimeType,
	type PassphraseId,
	type PublicId,
	publicId,
	type QuestionDataId,
	type QuestionRefId,
	type RegradeRequestId,
	type ReportId,
	type RepositoryId,
	type ResourceId,
	type ResponseId,
	type RollCallId,
	rowVersion,
	type SessionId,
	type Slug,
	type SlugHash,
	type SubmissionId,
	slugHash,
	type TimeSlotId,
	type UserId,
	username,
} from "./base";
export * from "./blob";
export * from "./calendar-event";
export * from "./calendar-feed";
export * from "./course";
export * from "./discipline";
export * from "./edition";
export * from "./enrollment";
export * from "./exam";
export * from "./exam-adjustment";
export * from "./exam-exception";
export * from "./feedback";
export * from "./grade-column";
export * from "./grading-job";
export * from "./invite";
export * from "./page";
export * from "./passphrase";
export * from "./question";
export * from "./regrade-request";
export * from "./report";
export * from "./repository";
export * from "./resource";
export * from "./response";
export * from "./roll-call";
export * from "./rubric";
export * from "./session";
export * from "./submission";
export * from "./time-slot";
export * from "./user";
