export * as schema from "../core/schemas";

import { apiKeyService } from "./services/api-key.service";
import { calendarEventService } from "./services/calendar-event.service";
import { courseService } from "./services/course.service";
import { disciplineService } from "./services/discipline.service";
import { editionService } from "./services/edition.service";
import { fileService } from "./services/file.service";
import { inviteService } from "./services/invite.service";
import { passphraseService } from "./services/passphrase.service";
import { resourceService } from "./services/resource.service";
import { sessionService } from "./services/session.service";
import { timeSlotService } from "./services/time-slot.service";
import { userService } from "./services/user.service";

export type {
    ApiKey,
    ApiKeyCreate,
    ApiKeyFilter,
    ApiKeyPK,
} from "./services/api-key.service";
export type {
    CalendarEvent,
    CalendarEventCreate,
    CalendarEventFilter,
    CalendarEventPK,
    CalendarEventUpdate,
    EventKind,
    LinkedExam,
} from "./services/calendar-event.service";
export type {
    Course,
    CourseCreate,
    CourseEnrollInput,
    CourseFilter,
    CoursePK,
    CourseRef,
    CourseUnenrollInput,
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
export type {
    File,
    FileCreate,
    FileFilter,
    FilePK,
    FileUpdate,
} from "./services/file.service";
export type {
    Invite,
    InviteCreate,
    InviteCreateResult,
    InviteFilter,
    InviteListItem,
    InvitePK,
    InviteTokenFilter,
    InviteUpdate,
    InviteWithCount,
} from "./services/invite.service";
export type {
    Passphrase,
    PassphraseCreate,
    PassphraseFilter,
    PassphrasePK,
    PassphraseUpdate,
} from "./services/passphrase.service";
export type {
    Resource,
    ResourceCreate,
    ResourceFilter,
    ResourcePK,
    ResourceRef,
    ResourceUpdate,
} from "./services/resource.service";
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

/**
 * This is the main entry point for the database layer.
 *
 * All services are accessed through the db namespace in this module.
 */
export const db = {
    apiKey: apiKeyService,
    calendarEvent: calendarEventService,
    course: courseService,
    discipline: disciplineService,
    edition: editionService,
    file: fileService,
    invite: inviteService,
    passphrase: passphraseService,
    resource: resourceService,
    session: sessionService,
    timeSlot: timeSlotService,
    user: userService,
} as const;
