-- AlterTable
ALTER TABLE "Exam" ADD COLUMN "questionsFrozenAt" DATETIME;

-- CreateTable
CREATE TABLE "ExamAdjustment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "publicId" TEXT NOT NULL,
    "responseId" INTEGER NOT NULL,
    "questionRefId" INTEGER,
    "op" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "reason" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "revokedAt" DATETIME,
    "revokedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExamAdjustment_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "ResponseRef" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExamAdjustment_questionRefId_fkey" FOREIGN KEY ("questionRefId") REFERENCES "QuestionRef" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExamAdjustment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("username") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ExamAdjustment_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User" ("username") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ResponseRef" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "publicId" TEXT NOT NULL,
    "acceptingSubmissions" BOOLEAN NOT NULL DEFAULT true,
    "closedAt" DATETIME,
    "authorId" TEXT NOT NULL,
    "examId" INTEGER NOT NULL,
    "slotKey" INTEGER NOT NULL DEFAULT 0,
    "preview" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ResponseRef_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("username") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ResponseRef_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ResponseRef_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("username") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ResponseRef" ("acceptingSubmissions", "authorId", "closedAt", "createdAt", "examId", "id", "preview", "publicId", "slotKey", "updatedAt") SELECT "acceptingSubmissions", "authorId", "closedAt", "createdAt", "examId", "id", "preview", "publicId", "slotKey", "updatedAt" FROM "ResponseRef";
DROP TABLE "ResponseRef";
ALTER TABLE "new_ResponseRef" RENAME TO "ResponseRef";
CREATE UNIQUE INDEX "ResponseRef_publicId_key" ON "ResponseRef"("publicId");
CREATE INDEX "ResponseRef_examId_idx" ON "ResponseRef"("examId");
CREATE UNIQUE INDEX "ResponseRef_authorId_examId_slotKey_key" ON "ResponseRef"("authorId", "examId", "slotKey");
CREATE TABLE "new_Submission" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "publicId" TEXT NOT NULL,
    "automaticallyTriggered" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'PENDING_GRADE',
    "kind" TEXT NOT NULL DEFAULT 'AUTOSAVE',
    "responseId" INTEGER NOT NULL,
    "questionId" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "createdById" TEXT,
    "runnerReport" JSONB,
    "startedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Submission_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "ResponseRef" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Submission_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QuestionRef" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Submission_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("username") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Submission" ("automaticallyTriggered", "createdAt", "id", "kind", "payload", "publicId", "questionId", "responseId", "runnerReport", "startedAt", "status") SELECT "automaticallyTriggered", "createdAt", "id", "kind", "payload", "publicId", "questionId", "responseId", "runnerReport", "startedAt", "status" FROM "Submission";
DROP TABLE "Submission";
ALTER TABLE "new_Submission" RENAME TO "Submission";
CREATE UNIQUE INDEX "Submission_publicId_key" ON "Submission"("publicId");
CREATE INDEX "Submission_responseId_questionId_idx" ON "Submission"("responseId", "questionId");
CREATE INDEX "Submission_questionId_idx" ON "Submission"("questionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ExamAdjustment_publicId_key" ON "ExamAdjustment"("publicId");

-- CreateIndex
CREATE INDEX "ExamAdjustment_responseId_idx" ON "ExamAdjustment"("responseId");

-- CreateIndex
CREATE INDEX "ExamAdjustment_questionRefId_idx" ON "ExamAdjustment"("questionRefId");
