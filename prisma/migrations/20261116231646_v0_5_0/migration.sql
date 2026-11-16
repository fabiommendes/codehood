-- AlterTable
ALTER TABLE "Exam" ADD COLUMN "attachments" JSONB;
ALTER TABLE "Exam" ADD COLUMN "files" JSONB;

-- AlterTable
ALTER TABLE "QuestionData" ADD COLUMN "files" JSONB;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Course" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "description" TEXT,
    "disciplineSlug" TEXT NOT NULL,
    "edition" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "rev" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    CONSTRAINT "Course_disciplineSlug_fkey" FOREIGN KEY ("disciplineSlug") REFERENCES "Discipline" ("slug") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Course_edition_fkey" FOREIGN KEY ("edition") REFERENCES "Edition" ("slug") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Course_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "User" ("username") ON DELETE RESTRICT ON UPDATE CASCADE
);
-- startAt/endAt were instants at local or UTC midnight; the instant plus twelve
-- hours, read in UTC, is the calendar date for zones between UTC-12 and UTC+12.
INSERT INTO "new_Course" ("createdAt", "description", "disciplineSlug", "edition", "id", "instructorId", "rev", "updatedAt", "startDate", "endDate") SELECT "createdAt", "description", "disciplineSlug", "edition", "id", "instructorId", "rev", "updatedAt", CASE typeof("startAt") WHEN 'integer' THEN strftime('%Y-%m-%d', "startAt" / 1000 + 43200, 'unixepoch') ELSE strftime('%Y-%m-%d', "startAt", '+12 hours') END, CASE typeof("endAt") WHEN 'integer' THEN strftime('%Y-%m-%d', "endAt" / 1000 + 43200, 'unixepoch') ELSE strftime('%Y-%m-%d', "endAt", '+12 hours') END FROM "Course";
DROP TABLE "Course";
ALTER TABLE "new_Course" RENAME TO "Course";
CREATE UNIQUE INDEX "Course_disciplineSlug_instructorId_edition_key" ON "Course"("disciplineSlug", "instructorId", "edition");
CREATE TABLE "new_Edition" (
    "slug" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Edition" ("createdAt", "name", "slug", "startDate", "endDate") SELECT "createdAt", "name", "slug", CASE typeof("startAt") WHEN 'integer' THEN strftime('%Y-%m-%d', "startAt" / 1000 + 43200, 'unixepoch') ELSE strftime('%Y-%m-%d', "startAt", '+12 hours') END, CASE typeof("endAt") WHEN 'integer' THEN strftime('%Y-%m-%d', "endAt" / 1000 + 43200, 'unixepoch') ELSE strftime('%Y-%m-%d', "endAt", '+12 hours') END FROM "Edition";
DROP TABLE "Edition";
ALTER TABLE "new_Edition" RENAME TO "Edition";
CREATE TABLE "new_ResponseRef" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "publicId" TEXT NOT NULL,
    "acceptingSubmissions" BOOLEAN NOT NULL DEFAULT true,
    "closedAt" DATETIME,
    "authorId" TEXT NOT NULL,
    "examId" INTEGER NOT NULL,
    "slotKey" INTEGER NOT NULL DEFAULT 0,
    "preview" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ResponseRef_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("username") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ResponseRef_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ResponseRef" ("acceptingSubmissions", "authorId", "closedAt", "createdAt", "examId", "id", "publicId", "slotKey", "updatedAt") SELECT "acceptingSubmissions", "authorId", "closedAt", "createdAt", "examId", "id", "publicId", "slotKey", "updatedAt" FROM "ResponseRef";
DROP TABLE "ResponseRef";
ALTER TABLE "new_ResponseRef" RENAME TO "ResponseRef";
CREATE UNIQUE INDEX "ResponseRef_publicId_key" ON "ResponseRef"("publicId");
CREATE INDEX "ResponseRef_examId_idx" ON "ResponseRef"("examId");
CREATE UNIQUE INDEX "ResponseRef_authorId_examId_slotKey_key" ON "ResponseRef"("authorId", "examId", "slotKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "AnswerEditField_questionId_idx" ON "AnswerEditField"("questionId");

-- CreateIndex
CREATE INDEX "Enrollment_courseId_status_idx" ON "Enrollment"("courseId", "status");

-- CreateIndex
CREATE INDEX "Feedback_rubricId_idx" ON "Feedback"("rubricId");

-- CreateIndex
CREATE INDEX "GradingJob_state_leaseUntil_idx" ON "GradingJob"("state", "leaseUntil");

-- CreateIndex
CREATE INDEX "QuestionRef_courseId_idx" ON "QuestionRef"("courseId");

-- CreateIndex
CREATE INDEX "QuestionRef_latestId_idx" ON "QuestionRef"("latestId");

-- CreateIndex
CREATE INDEX "QuestionsForExam_questionRefId_idx" ON "QuestionsForExam"("questionRefId");

-- CreateIndex
CREATE INDEX "Rubric_questionRefId_idx" ON "Rubric"("questionRefId");

-- CreateIndex
CREATE INDEX "Submission_responseId_questionId_idx" ON "Submission"("responseId", "questionId");

-- CreateIndex
CREATE INDEX "Submission_questionId_idx" ON "Submission"("questionId");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");
