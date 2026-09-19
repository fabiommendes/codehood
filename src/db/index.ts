/**
 * The main interface for accessing all database services.
 *
 * Do not import the service modules directly; use the `db` object instead.
 */
export * as schema from "@/core/schemas";

import { ApiKeyService } from "./services/api-key.service";
import { AttachmentService } from "./services/attachment.service";
import { BlobService } from "./services/blob.service";
import { CalendarEventService } from "./services/calendar-event.service";
import { CourseService } from "./services/course.service";
import { DisciplineService } from "./services/discipline.service";
import { EditionService } from "./services/edition.service";
import { EnrollmentService } from "./services/enrollment.service";
import { InviteService } from "./services/invite.service";
import { PassphraseService } from "./services/passphrase.service";
import { QuestionService } from "./services/question.service";
import { ResourceService } from "./services/resource.service";
import { SessionService } from "./services/session.service";
import { TimeSlotService } from "./services/time-slot.service";
import { UserService } from "./services/user.service";

export type { ServiceOpts } from "@/db/base-service";

export type {
	ApiKey,
	ApiKeyCreate,
	ApiKeyFilter,
	ApiKeyPK,
} from "./services/api-key.service";
export type {
	Attachment,
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
	LinkedExam,
} from "./services/calendar-event.service";
export { isMeeting } from "./services/calendar-event.service";
export type {
	Course,
	CourseCreate,
	CourseFilter,
	CourseNaturalKey,
	CoursePK,
	CourseUpdate,
	CourseUpsert,
} from "./services/course.service";
export { toEnrollmentView } from "./services/course.service";
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
	PassphraseFilter,
	PassphrasePK,
	PassphraseUpdate,
} from "./services/passphrase.service";
export type {
	Question,
	QuestionCreate,
	QuestionFilter,
	QuestionPK,
	QuestionPublic,
	QuestionUpdate,
	QuestionUpsert,
	QuestionView,
} from "./services/question.service";
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
	Session,
	SessionCreate,
	SessionCreateResult,
	SessionDeletePK,
} from "./services/session.service";
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
const blobService = new BlobService();
const attachmentService = new AttachmentService(blobService);

/**
 * This is the main entry point for the database layer.
 *
 * All services are accessed through the db namespace in this module.
 */
export const db = {
	apiKey: new ApiKeyService(),
	attachment: attachmentService,
	blob: blobService,
	calendarEvent: new CalendarEventService(),
	course: new CourseService(),
	discipline: new DisciplineService(),
	edition: new EditionService(),
	enrollment: new EnrollmentService(),
	invite: new InviteService(),
	passphrase: new PassphraseService(),
	question: new QuestionService(),
	resource: new ResourceService(attachmentService),
	session: new SessionService(),
	timeSlot: new TimeSlotService(),
	user: new UserService(),
} as const;
