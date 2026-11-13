-- AlterTable
ALTER TABLE "Exam" ADD COLUMN "allowCodeRun" BOOLEAN;
ALTER TABLE "Exam" ADD COLUMN "answerHistory" BOOLEAN;

-- AlterTable
ALTER TABLE "QuestionRef" ADD COLUMN "attempts" INTEGER;
ALTER TABLE "QuestionRef" ADD COLUMN "penalty" TEXT;
ALTER TABLE "QuestionRef" ADD COLUMN "worker" TEXT;

-- AlterTable
ALTER TABLE "ResponseRef" ADD COLUMN "closedAt" DATETIME;

-- CreateTable
CREATE TABLE "GradingJob" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "submissionId" INTEGER NOT NULL,
    "worker" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'QUEUED',
    "claimedBy" TEXT,
    "leaseUntil" DATETIME,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GradingJob_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Rubric" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "examId" INTEGER NOT NULL,
    "questionRefId" INTEGER NOT NULL,
    "base" TEXT NOT NULL DEFAULT '0',
    "sourceVersion" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Rubric_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Rubric_questionRefId_fkey" FOREIGN KEY ("questionRefId") REFERENCES "QuestionRef" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RubricItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "rubricId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "group" TEXT,
    "text" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "comment" TEXT,
    "feedback" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "retiredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RubricItem_rubricId_fkey" FOREIGN KEY ("rubricId") REFERENCES "Rubric" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FeedbackRubricItem" (
    "feedbackId" INTEGER NOT NULL,
    "itemId" INTEGER NOT NULL,

    PRIMARY KEY ("feedbackId", "itemId"),
    CONSTRAINT "FeedbackRubricItem_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "Feedback" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FeedbackRubricItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "RubricItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AnswerEditHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "responseId" INTEGER NOT NULL,
    "editCount" INTEGER NOT NULL DEFAULT 0,
    "byteCount" INTEGER NOT NULL DEFAULT 0,
    "incompleteAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AnswerEditHistory_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "ResponseRef" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AnswerEditField" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "historyId" INTEGER NOT NULL,
    "questionId" INTEGER NOT NULL,
    "field" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "nextSeq" INTEGER NOT NULL DEFAULT 0,
    "incompleteAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AnswerEditField_historyId_fkey" FOREIGN KEY ("historyId") REFERENCES "AnswerEditHistory" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AnswerEditField_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QuestionRef" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AnswerEditBatch" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fieldId" INTEGER NOT NULL,
    "batchId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "firstSeq" INTEGER NOT NULL,
    "editCount" INTEGER NOT NULL,
    "sessionId" TEXT NOT NULL,
    "timeOriginMs" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "edits" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "byteCount" INTEGER NOT NULL,
    "baseReason" TEXT,
    "baseText" TEXT,
    "gapBefore" TEXT,
    "lateMs" INTEGER,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnswerEditBatch_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "AnswerEditField" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AnswerEditGap" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fieldId" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "clientId" TEXT,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnswerEditGap_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "AnswerEditField" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Discipline" (
    "slug" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Discipline" ("createdAt", "name", "slug") SELECT "createdAt", "name", "slug" FROM "Discipline";
DROP TABLE "Discipline";
ALTER TABLE "new_Discipline" RENAME TO "Discipline";
CREATE TABLE "new_Feedback" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ref" TEXT NOT NULL,
    "submissionId" INTEGER NOT NULL,
    "score" TEXT NOT NULL,
    "graderId" TEXT,
    "botId" TEXT,
    "feedback" TEXT,
    "notes" TEXT,
    "blanks" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "rubricId" INTEGER,
    "adjustment" TEXT,
    CONSTRAINT "Feedback_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Feedback_graderId_fkey" FOREIGN KEY ("graderId") REFERENCES "User" ("username") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Feedback_rubricId_fkey" FOREIGN KEY ("rubricId") REFERENCES "Rubric" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Feedback" ("blanks", "botId", "createdAt", "feedback", "graderId", "id", "ref", "score", "submissionId", "updatedAt") SELECT "blanks", "botId", "createdAt", "feedback", "graderId", "id", "ref", "score", "submissionId", "updatedAt" FROM "Feedback";
DROP TABLE "Feedback";
ALTER TABLE "new_Feedback" RENAME TO "Feedback";
CREATE UNIQUE INDEX "Feedback_submissionId_ref_key" ON "Feedback"("submissionId", "ref");
CREATE TABLE "new_Submission" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "publicId" TEXT NOT NULL,
    "automaticallyTriggered" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'PENDING_GRADE',
    "kind" TEXT NOT NULL DEFAULT 'AUTOSAVE',
    "responseId" INTEGER NOT NULL,
    "questionId" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "runnerReport" JSONB,
    "startedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Submission_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "ResponseRef" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Submission_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QuestionRef" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Submission" ("automaticallyTriggered", "createdAt", "id", "payload", "publicId", "questionId", "responseId", "startedAt", "status") SELECT "automaticallyTriggered", "createdAt", "id", "payload", "publicId", "questionId", "responseId", "startedAt", "status" FROM "Submission";
DROP TABLE "Submission";
ALTER TABLE "new_Submission" RENAME TO "Submission";
CREATE UNIQUE INDEX "Submission_publicId_key" ON "Submission"("publicId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "GradingJob_submissionId_key" ON "GradingJob"("submissionId");

-- CreateIndex
CREATE INDEX "GradingJob_worker_state_idx" ON "GradingJob"("worker", "state");

-- CreateIndex
CREATE UNIQUE INDEX "Rubric_examId_questionRefId_key" ON "Rubric"("examId", "questionRefId");

-- CreateIndex
CREATE UNIQUE INDEX "RubricItem_rubricId_key_key" ON "RubricItem"("rubricId", "key");

-- CreateIndex
CREATE INDEX "FeedbackRubricItem_itemId_idx" ON "FeedbackRubricItem"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "AnswerEditHistory_responseId_key" ON "AnswerEditHistory"("responseId");

-- CreateIndex
CREATE UNIQUE INDEX "AnswerEditField_historyId_questionId_field_key" ON "AnswerEditField"("historyId", "questionId", "field");

-- CreateIndex
CREATE UNIQUE INDEX "AnswerEditBatch_fieldId_revision_key" ON "AnswerEditBatch"("fieldId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "AnswerEditBatch_fieldId_batchId_key" ON "AnswerEditBatch"("fieldId", "batchId");

-- CreateIndex
CREATE INDEX "AnswerEditGap_fieldId_idx" ON "AnswerEditGap"("fieldId");

-- CreateIndex
CREATE UNIQUE INDEX "AnswerEditGap_fieldId_clientId_key" ON "AnswerEditGap"("fieldId", "clientId");

-- CreateIndex
CREATE INDEX "QuestionRef_worker_idx" ON "QuestionRef"("worker");
