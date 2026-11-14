/**
 * The main interface for accessing all database services.
 *
 * Do not import the service modules directly; use the `db` object instead.
 */
export * as schema from "@/core/schemas";

import { makeAnswerEditService } from "./services/answer-edit.service";
import { makeApiKeyService } from "./services/api-key.service";
import { makeAttachmentService } from "./services/attachment.service";
import { makeBlobService } from "./services/blob.service";
import { makeCalendarEventService } from "./services/calendar-event.service";
import { makeCalendarFeedService } from "./services/calendar-feed.service";
import { makeCourseService } from "./services/course.service";
import { makeDisciplineService } from "./services/discipline.service";
import { makeEditionService } from "./services/edition.service";
import { makeEnrollmentService } from "./services/enrollment.service";
import { makeExamService } from "./services/exam.service";
import { makeExamExceptionService } from "./services/exam-exception.service";
import { makeFeedbackService } from "./services/feedback.service";
import { makeGradeColumnService } from "./services/grade-column.service";
import { makeGradingJobService } from "./services/grading-job.service";
import { checkRedeemable, makeInviteService } from "./services/invite.service";
import { makePassphraseService } from "./services/passphrase.service";
import { makeQuestionService } from "./services/question.service";
import { makeRegradeRequestService } from "./services/regrade-request.service";

export type {
	Report,
	ReportCreate,
	ReportFilter,
	ReportPK,
	ReportUpdate,
} from "./services/report.service";

import { makeReportService } from "./services/report.service";
import { makeRepositoryService } from "./services/repository.service";
import { makeResourceService } from "./services/resource.service";
import { makeResponseService } from "./services/response.service";
import { makeRollCallService } from "./services/roll-call.service";

export type {
	Rubric,
	RubricChange,
	RubricItem,
	RubricItemCreate,
	RubricItemPK,
	RubricItemUpdate,
	RubricPK,
	RubricPreview,
	RubricRenameGroup,
	RubricRenameResult,
	RubricSplit,
	RubricUpdate,
} from "./services/rubric.service";

import { makeRubricService } from "./services/rubric.service";
import {
	makeSessionService,
	validateSession,
} from "./services/session.service";
import { makeSubmissionService } from "./services/submission.service";
import { makeTimeSlotService } from "./services/time-slot.service";
import { makeUserService } from "./services/user.service";

export type {
	ApiKeyKind,
	EnrollmentStatus,
	ExamStatus,
	InviteKind,
	RegradeStatus,
	ReportKind,
	ReportStatus,
	ResourceType,
	Role,
	SubmissionStatus,
} from "../generated/prisma/client";
export type { ServiceOpts } from "./base-service";
export type {
	ApiKey,
	ApiKeyCreate,
	ApiKeyFilter,
	ApiKeyPK,
} from "./services/api-key.service";
export type {
	Attachment,
	AttachmentAttach,
	AttachmentCreate,
	AttachmentFilter,
	AttachmentPK,
	AttachmentUpdate,
} from "./services/attachment.service";
export type {
	Blob,
	BlobCreate,
	BlobFilter,
	BlobPK,
} from "./services/blob.service";
export type {
	CalendarEvent,
	CalendarEventCreate,
	CalendarEventFilter,
	CalendarEventPK,
	CalendarEventUpdate,
	EventKind,
	Weekday,
} from "./services/calendar-event.service";
export { isMeeting } from "./services/calendar-event.service";
export type {
	CalendarFeed,
	CalendarFeedPK,
} from "./services/calendar-feed.service";
export type {
	Course,
	CourseCreate,
	CourseFilter,
	CourseNaturalKey,
	CoursePK,
	CourseUpdate,
} from "./services/course.service";
export type {
	Discipline,
	DisciplineCreate,
	DisciplineFilter,
	DisciplinePK,
	DisciplineUpdate,
} from "./services/discipline.service";
export type {
	Edition,
	EditionCreate,
	EditionFilter,
	EditionPK,
	EditionUpdate,
} from "./services/edition.service";
export { isEditionOpen } from "./services/edition.service";
export type {
	Enrollment,
	EnrollmentCreate,
	EnrollmentFilter,
	EnrollmentPK,
} from "./services/enrollment.service";
export type {
	CourseExam,
	Exam,
	ExamCreate,
	ExamFilter,
	ExamFilterByCourses,
	ExamGroup,
	ExamPK,
	ExamUpdate,
} from "./services/exam.service";
export { groupExamsForStudent } from "./services/exam.service";
export type {
	ExamException,
	ExamExceptionCreate,
	ExamExceptionFilter,
	ExamExceptionPK,
	ExamExceptionPublic,
	ExamExceptionUpdate,
	ExamExceptionView,
} from "./services/exam-exception.service";
export type {
	Feedback,
	FeedbackCreate,
	FeedbackFilter,
	FeedbackPK,
	FeedbackUpdate,
} from "./services/feedback.service";
export type {
	GradeColumn,
	GradeColumnCreate,
	GradeColumnFilter,
	GradeColumnPK,
	GradeColumnUpdate,
} from "./services/grade-column.service";
export type {
	Invite,
	InviteCreate,
	InviteErrorCode,
	InviteFilter,
	InvitePK,
	InviteUpdate,
} from "./services/invite.service";
export { InviteError } from "./services/invite.service";
export type {
	Passphrase,
	PassphraseCreate,
	PassphraseErrorCode,
	PassphraseFilter,
	PassphrasePK,
	PassphraseRedemption,
	PassphraseUpdate,
} from "./services/passphrase.service";
export { PassphraseError } from "./services/passphrase.service";
export type {
	Question,
	QuestionCreate,
	QuestionFilter,
	QuestionPK,
	QuestionPublic,
	QuestionUpdate,
	QuestionView,
} from "./services/question.service";
export type {
	RegradeAccept,
	RegradeReject,
	RegradeRequest,
	RegradeRequestCreate,
	RegradeRequestFilter,
	RegradeRequestPK,
} from "./services/regrade-request.service";
export type {
	Repository,
	RepositoryCommit,
	RepositoryCreate,
	RepositoryDirEntry,
	RepositoryFiles,
	RepositoryFilesResult,
	RepositoryFilter,
	RepositoryHandle,
	RepositoryPK,
} from "./services/repository.service";
export type {
	Resource,
	ResourceCreate,
	ResourceFilter,
	ResourceGroup,
	ResourcePK,
	ResourceUpdate,
} from "./services/resource.service";
export { groupResourcesByType } from "./services/resource.service";
export type {
	Response,
	ResponseCreate,
	ResponseFilter,
	ResponsePK,
	ResponseSubmit,
	ResponseUpdate,
} from "./services/response.service";
export { PRACTICE_SESSION_WINDOW_MS } from "./services/response.service";
export type {
	CourseAttendance,
	RollCall,
	RollCallCreate,
	RollCallFilter,
	RollCallPK,
	RollCallUpdate,
} from "./services/roll-call.service";
export type {
	Session,
	SessionCreate,
	SessionCreateResult,
	SessionDeletePK,
} from "./services/session.service";
export type {
	Submission,
	SubmissionCreate,
	SubmissionFilter,
	SubmissionPK,
	SubmissionUpdate,
} from "./services/submission.service";
export type {
	TimeSlot,
	TimeSlotCreate,
	TimeSlotFilter,
	TimeSlotPK,
	TimeSlotRef,
	TimeSlotUpdate,
} from "./services/time-slot.service";
export type {
	User,
	UserCreate,
	UserFilter,
	UserPK,
	UserUpdate,
} from "./services/user.service";

// Instantiate dependencies.
const blobService = makeBlobService();
const attachmentService = makeAttachmentService(blobService);
const feedbackService = makeFeedbackService();

/**
 * This is the main entry point for the database layer.
 *
 * All services are accessed through the db namespace in this module.
 */
export const db = {
	answerEdit: makeAnswerEditService(),
	apiKey: makeApiKeyService(),
	attachment: attachmentService,
	blob: blobService,
	calendarEvent: makeCalendarEventService(),
	calendarFeed: makeCalendarFeedService(),
	course: makeCourseService(),
	discipline: makeDisciplineService(),
	edition: makeEditionService(),
	enrollment: makeEnrollmentService(),
	exam: makeExamService(attachmentService, blobService),
	examException: makeExamExceptionService(),
	feedback: feedbackService,
	gradeColumn: makeGradeColumnService(),
	gradingJob: makeGradingJobService(),
	invite: { ...makeInviteService(), checkRedeemable },
	passphrase: makePassphraseService(),
	question: makeQuestionService(attachmentService, blobService),
	regradeRequest: makeRegradeRequestService(),
	report: makeReportService(attachmentService, blobService),
	repository: makeRepositoryService(blobService, attachmentService),
	resource: makeResourceService(attachmentService),
	response: makeResponseService(),
	rollCall: makeRollCallService(),
	rubric: makeRubricService(),
	session: { ...makeSessionService(), validate: validateSession },
	submission: makeSubmissionService(),
	timeSlot: makeTimeSlotService(),
	user: makeUserService(),
} as const;
