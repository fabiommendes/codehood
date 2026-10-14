-- CreateTable
CREATE TABLE "User" (
    "username" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "githubId" TEXT NOT NULL,
    "image" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Group" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "publicId" TEXT NOT NULL,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "GroupMembership" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "groupId" INTEGER NOT NULL,
    "username" TEXT NOT NULL,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "GroupMembership_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GroupMembership_username_fkey" FOREIGN KEY ("username") REFERENCES "User" ("username") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "username" TEXT NOT NULL,
    CONSTRAINT "Session_username_fkey" FOREIGN KEY ("username") REFERENCES "User" ("username") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "publicId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "lastUsedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApiKey_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("username") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Invite" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "publicId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "invitedRole" TEXT NOT NULL,
    "maxUses" INTEGER,
    "email" TEXT,
    "courseId" INTEGER,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "Invite_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("username") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InviteRedemption" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "inviteId" INTEGER NOT NULL,
    "username" TEXT NOT NULL,
    "redeemedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InviteRedemption_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "Invite" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InviteRedemption_username_fkey" FOREIGN KEY ("username") REFERENCES "User" ("username") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Blob" (
    "hash" TEXT NOT NULL PRIMARY KEY,
    "size" INTEGER NOT NULL,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "hash" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "uploaderUsername" TEXT,
    "attachedToType" TEXT NOT NULL,
    "attachedToId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Attachment_hash_fkey" FOREIGN KEY ("hash") REFERENCES "Blob" ("hash") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attachment_uploaderUsername_fkey" FOREIGN KEY ("uploaderUsername") REFERENCES "User" ("username") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Course" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "description" TEXT,
    "disciplineSlug" TEXT NOT NULL,
    "edition" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "rev" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "startAt" DATETIME NOT NULL,
    "endAt" DATETIME NOT NULL,
    CONSTRAINT "Course_disciplineSlug_fkey" FOREIGN KEY ("disciplineSlug") REFERENCES "Discipline" ("slug") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Course_edition_fkey" FOREIGN KEY ("edition") REFERENCES "Edition" ("slug") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Course_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "User" ("username") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Discipline" (
    "slug" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Edition" (
    "slug" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "startAt" DATETIME NOT NULL,
    "endAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Enrollment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "username" TEXT NOT NULL,
    "courseId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Enrollment_username_fkey" FOREIGN KEY ("username") REFERENCES "User" ("username") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Enrollment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GradeColumn" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "kind" TEXT NOT NULL,
    "courseId" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "releasedAt" DATETIME,
    "rev" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GradeColumn_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GradeValue" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "columnId" INTEGER NOT NULL,
    "username" TEXT NOT NULL,
    "number" REAL,
    "label" TEXT,
    CONSTRAINT "GradeValue_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "GradeColumn" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GradeValue_username_fkey" FOREIGN KEY ("username") REFERENCES "User" ("username") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Passphrase" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "courseId" INTEGER NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Passphrase_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TimeSlot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "courseId" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT,
    "day" TEXT NOT NULL,
    "startMin" INTEGER NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TimeSlot_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "kind" TEXT NOT NULL DEFAULT 'REGULAR',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "courseId" INTEGER NOT NULL,
    "timeSlotId" INTEGER NOT NULL,
    "startAt" DATETIME NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "week" INTEGER NOT NULL,
    "rev" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CalendarEvent_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CalendarEvent_timeSlotId_courseId_fkey" FOREIGN KEY ("timeSlotId", "courseId") REFERENCES "TimeSlot" ("id", "courseId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RollCall" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "eventId" INTEGER NOT NULL,
    "secret" TEXT NOT NULL,
    "actsAsInvite" BOOLEAN NOT NULL DEFAULT false,
    "closesAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RollCall_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "rollCallId" INTEGER NOT NULL,
    "username" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "deviceHash" TEXT,
    "joined" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Attendance_rollCallId_fkey" FOREIGN KEY ("rollCallId") REFERENCES "RollCall" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attendance_username_fkey" FOREIGN KEY ("username") REFERENCES "User" ("username") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Resource" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL,
    "courseId" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "data" TEXT,
    "extra" TEXT,
    "attachmentId" INTEGER,
    "eventId" INTEGER,
    "rev" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Resource_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Resource_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "Attachment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Resource_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuestionRef" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "publicId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "type" TEXT NOT NULL,
    "courseId" INTEGER NOT NULL,
    "latestId" INTEGER,
    "rev" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "groupId" INTEGER,
    CONSTRAINT "QuestionRef_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuestionRef_latestId_fkey" FOREIGN KEY ("latestId") REFERENCES "QuestionData" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "QuestionRef_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuestionData" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "versionHash" TEXT NOT NULL,
    "refId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "stem" TEXT NOT NULL,
    "publicPayload" JSONB NOT NULL,
    "privatePayload" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuestionData_refId_fkey" FOREIGN KEY ("refId") REFERENCES "QuestionRef" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuestionTags" (
    "questionId" INTEGER NOT NULL,
    "tag" TEXT NOT NULL,

    PRIMARY KEY ("questionId", "tag"),
    CONSTRAINT "QuestionTags_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QuestionRef" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuestionForCourse" (
    "courseId" INTEGER NOT NULL,
    "questionId" INTEGER NOT NULL,
    "version" TEXT,

    PRIMARY KEY ("courseId", "questionId"),
    CONSTRAINT "QuestionForCourse_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "QuestionForCourse_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QuestionRef" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResponseRef" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "publicId" TEXT NOT NULL,
    "acceptingSubmissions" BOOLEAN NOT NULL DEFAULT true,
    "authorId" TEXT NOT NULL,
    "examId" INTEGER NOT NULL,
    "slotKey" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ResponseRef_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("username") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ResponseRef_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "publicId" TEXT NOT NULL,
    "automaticallyTriggered" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'PENDING_GRADE',
    "responseId" INTEGER NOT NULL,
    "questionId" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "startedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Submission_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "ResponseRef" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Submission_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QuestionRef" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ref" TEXT NOT NULL,
    "submissionId" INTEGER NOT NULL,
    "score" TEXT NOT NULL,
    "graderId" TEXT,
    "botId" TEXT,
    "feedback" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Feedback_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Feedback_graderId_fkey" FOREIGN KEY ("graderId") REFERENCES "User" ("username") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Exam" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL DEFAULT 'EXAM',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "slug" TEXT NOT NULL,
    "courseId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "preamble" TEXT,
    "format" TEXT NOT NULL DEFAULT 'MARKDOWN',
    "scheduledAt" DATETIME,
    "durationMs" INTEGER,
    "extraTimeMs" INTEGER NOT NULL DEFAULT 0,
    "gradesReleasedAt" DATETIME,
    "authorId" TEXT NOT NULL,
    "rev" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Exam_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Exam_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("username") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuestionsForExam" (
    "examId" INTEGER NOT NULL,
    "questionRefId" INTEGER NOT NULL,
    "version" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("examId", "questionRefId"),
    CONSTRAINT "QuestionsForExam_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "QuestionsForExam_questionRefId_fkey" FOREIGN KEY ("questionRefId") REFERENCES "QuestionRef" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExamTags" (
    "examId" INTEGER NOT NULL,
    "tag" TEXT NOT NULL,

    PRIMARY KEY ("examId", "tag"),
    CONSTRAINT "ExamTags_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_schoolId_key" ON "User"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "User_githubId_key" ON "User"("githubId");

-- CreateIndex
CREATE UNIQUE INDEX "Group_publicId_key" ON "Group"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMembership_groupId_username_key" ON "GroupMembership"("groupId", "username");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_publicId_key" ON "ApiKey"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE UNIQUE INDEX "Invite_publicId_key" ON "Invite"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "Invite_tokenHash_key" ON "Invite"("tokenHash");

-- CreateIndex
CREATE INDEX "InviteRedemption_username_idx" ON "InviteRedemption"("username");

-- CreateIndex
CREATE UNIQUE INDEX "InviteRedemption_inviteId_username_key" ON "InviteRedemption"("inviteId", "username");

-- CreateIndex
CREATE INDEX "Attachment_attachedToType_attachedToId_idx" ON "Attachment"("attachedToType", "attachedToId");

-- CreateIndex
CREATE INDEX "Attachment_hash_idx" ON "Attachment"("hash");

-- CreateIndex
CREATE INDEX "Attachment_uploaderUsername_idx" ON "Attachment"("uploaderUsername");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_hash_filename_attachedToType_attachedToId_key" ON "Attachment"("hash", "filename", "attachedToType", "attachedToId");

-- CreateIndex
CREATE UNIQUE INDEX "Course_disciplineSlug_instructorId_edition_key" ON "Course"("disciplineSlug", "instructorId", "edition");

-- CreateIndex
CREATE UNIQUE INDEX "Enrollment_username_courseId_key" ON "Enrollment"("username", "courseId");

-- CreateIndex
CREATE UNIQUE INDEX "GradeColumn_courseId_slug_key" ON "GradeColumn"("courseId", "slug");

-- CreateIndex
CREATE INDEX "GradeValue_username_idx" ON "GradeValue"("username");

-- CreateIndex
CREATE UNIQUE INDEX "GradeValue_columnId_username_key" ON "GradeValue"("columnId", "username");

-- CreateIndex
CREATE UNIQUE INDEX "Passphrase_value_key" ON "Passphrase"("value");

-- CreateIndex
CREATE UNIQUE INDEX "TimeSlot_courseId_slug_key" ON "TimeSlot"("courseId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "TimeSlot_id_courseId_key" ON "TimeSlot"("id", "courseId");

-- CreateIndex
CREATE INDEX "CalendarEvent_courseId_startAt_idx" ON "CalendarEvent"("courseId", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEvent_courseId_week_timeSlotId_key" ON "CalendarEvent"("courseId", "week", "timeSlotId");

-- CreateIndex
CREATE UNIQUE INDEX "RollCall_eventId_key" ON "RollCall"("eventId");

-- CreateIndex
CREATE INDEX "Attendance_rollCallId_deviceHash_idx" ON "Attendance"("rollCallId", "deviceHash");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_rollCallId_username_key" ON "Attendance"("rollCallId", "username");

-- CreateIndex
CREATE INDEX "Resource_courseId_type_idx" ON "Resource"("courseId", "type");

-- CreateIndex
CREATE INDEX "Resource_eventId_idx" ON "Resource"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "Resource_courseId_slug_key" ON "Resource"("courseId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionRef_publicId_key" ON "QuestionRef"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionRef_slug_courseId_key" ON "QuestionRef"("slug", "courseId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionData_refId_versionHash_key" ON "QuestionData"("refId", "versionHash");

-- CreateIndex
CREATE UNIQUE INDEX "ResponseRef_publicId_key" ON "ResponseRef"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "ResponseRef_authorId_examId_slotKey_key" ON "ResponseRef"("authorId", "examId", "slotKey");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_publicId_key" ON "Submission"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "Feedback_submissionId_ref_key" ON "Feedback"("submissionId", "ref");

-- CreateIndex
CREATE UNIQUE INDEX "Exam_courseId_slug_key" ON "Exam"("courseId", "slug");
