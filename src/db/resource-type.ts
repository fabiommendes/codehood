/**
 * The Db contribution to ResourceType.
 *
 * Used primarely when throwing NotAllowed errors.
 */
export type DbResourceType =
	| "api-key"
	| "calendar-event"
	| "discipline"
	| "edition"
	| "exam-tag"
	| "exam"
	| "invite"
	| "question"
	| "resource"
	| "session"
	| "time-slot"
	| "user";
