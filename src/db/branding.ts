/**
 * This module is used to add branded ids for most generated Prisma files.
 *
 * A branded ID is a proof that some object was retrieved from the database.
 * It might not exist anymore, but it ensure some level of consistent.
 *
 * Different tables have different branded types, so we cannot mix them by
 * accident.
 */

/**
 * Declare mappings from Prisma models to their branded types
 */
export const BRANDING: Record<string, Record<string, string>[]> = {
	ApiKey: [{ field: "id", from: "number", to: "ApiKeyId" }],
	Attachment: [{ field: "id", from: "number", to: "AttachmentId" }],
	Blob: [{ field: "id", from: "number", to: "BlobId" }],
	CalendarEvent: [
		{ field: "id", from: "number", to: "CalendarEventId" },
		{ field: "courseId", from: "number", to: "CourseId" },
		{ field: "timeSlotId", from: "number", to: "TimeSlotId" },
		{ field: "examId", from: "number", to: "ExamId" },
	],
	Course: [{ field: "id", from: "number", to: "CourseId" }],
	Enrollment: [
		{ field: "id", from: "number", to: "EnrollmentId" },
		{ field: "username", from: "number", to: "UserId" },
		{ field: "courseId", from: "number", to: "CourseId" },
	],
	Exam: [{ field: "id", from: "number", to: "ExamId" }],
	ExamTags: [{ field: "id", from: "number", to: "ExamTagsId" }],
	// Group: [{ field: "id", from: "number" , to: "GroupId"}],
	// GroupMembership: [{ field: "id", from: "number" , to: "GroupMembershipId"}],
	Invite: [
		{ field: "id", from: "number", to: "InviteId" },
		{ field: "courseId", from: "number", to: "CourseId" },
		{ field: "createdById", from: "number", to: "UserId" },
	],
	InviteRedemption: [{ field: "id", from: "number", to: "InviteRedemptionId" }],
	Passphrase: [{ field: "id", from: "number", to: "PassphraseId" }],
	QuestionData: [{ field: "id", from: "number", to: "QuestionDataId" }],
	// QuestionForCourse: [{ field: "id", from: "number" , to: "QuestionForCourseId"}],
	QuestionRef: [{ field: "id", from: "number", to: "QuestionRefId" }],
	// QuestionForExam: [{ field: "id", from: "number" , to: "QuestionForExamId"}],
	// QuestionTags: [{ field: "id", from: "number" , to: "QuestionTagsId"}],
	Resource: [
		{ field: "id", from: "number", to: "ResourceId" },
		{ field: "attachmentId", from: "number", to: "AttachmentId" },
	],
	Response: [{ field: "id", from: "number", to: "ResponseId" }],
	Session: [{ field: "id", from: "number", to: "SessionId" }],
	Submission: [{ field: "id", from: "number", to: "SubmissionId" }],
	TimeSlot: [{ field: "id", from: "number", to: "TimeSlotId" }],
	User: [{ field: "id", from: "number", to: "UserId" }],
};

/**
 * Brand source
 */
export function brandSource(args: { model: string; source: string }): string {
	let source = args.source;
	const model = args.model;
	const indexes = BRANDING[model];
	if (!indexes) return source;

	for (const item of indexes) {
		const { field, from: srcType, to: destType } = item;
		const regex = new RegExp(`(\\b${field}[?]?:\\s*)(${srcType})`, "g");
		source = source.replaceAll(regex, `$1import("@/core/schemas").${destType}`);
	}

	return `// BRANDED TYPES\n\n${source}\n\n// BRANDED TYPES`;
}
