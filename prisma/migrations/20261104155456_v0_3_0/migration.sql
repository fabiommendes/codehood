-- AlterTable
ALTER TABLE "Blob" ADD COLUMN "gitSha" TEXT;

-- AlterTable
ALTER TABLE "Feedback" ADD COLUMN "blanks" JSONB;

-- CreateTable
CREATE TABLE "CalendarFeed" (
    "username" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "lastUsedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CalendarFeed_username_fkey" FOREIGN KEY ("username") REFERENCES "User" ("username") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Repository" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "courseId" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "head" TEXT,
    "token" TEXT NOT NULL,
    "zipHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Repository_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GitObject" (
    "repositoryId" INTEGER NOT NULL,
    "sha" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" BLOB NOT NULL,

    PRIMARY KEY ("repositoryId", "sha"),
    CONSTRAINT "GitObject_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CalendarEventRepository" (
    "courseId" INTEGER NOT NULL,
    "eventId" INTEGER NOT NULL,
    "repositoryId" INTEGER NOT NULL,

    PRIMARY KEY ("eventId", "repositoryId"),
    CONSTRAINT "CalendarEventRepository_eventId_courseId_fkey" FOREIGN KEY ("eventId", "courseId") REFERENCES "CalendarEvent" ("id", "courseId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CalendarEventRepository_repositoryId_courseId_fkey" FOREIGN KEY ("repositoryId", "courseId") REFERENCES "Repository" ("id", "courseId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RegradeRequest" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "publicId" TEXT NOT NULL,
    "submissionId" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "reply" TEXT,
    "feedbackId" INTEGER,
    "resolvedById" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RegradeRequest_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RegradeRequest_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "Feedback" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RegradeRequest_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User" ("username") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExamException" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "examId" INTEGER NOT NULL,
    "username" TEXT NOT NULL,
    "extraTimeMs" INTEGER NOT NULL DEFAULT 0,
    "scheduledAt" DATETIME,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExamException_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExamException_username_fkey" FOREIGN KEY ("username") REFERENCES "User" ("username") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Report" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "publicId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "url" TEXT,
    "userAgent" TEXT,
    "viewport" TEXT,
    "authorId" TEXT NOT NULL,
    "courseId" INTEGER,
    "triagedById" TEXT,
    "triagedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Report_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("username") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Report_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Report_triagedById_fkey" FOREIGN KEY ("triagedById") REFERENCES "User" ("username") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CalendarFeed_token_key" ON "CalendarFeed"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_token_key" ON "Repository"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_courseId_slug_key" ON "Repository"("courseId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_id_courseId_key" ON "Repository"("id", "courseId");

-- CreateIndex
CREATE INDEX "CalendarEventRepository_repositoryId_idx" ON "CalendarEventRepository"("repositoryId");

-- CreateIndex
CREATE UNIQUE INDEX "RegradeRequest_publicId_key" ON "RegradeRequest"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "RegradeRequest_submissionId_key" ON "RegradeRequest"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "RegradeRequest_feedbackId_key" ON "RegradeRequest"("feedbackId");

-- CreateIndex
CREATE INDEX "ExamException_username_idx" ON "ExamException"("username");

-- CreateIndex
CREATE UNIQUE INDEX "ExamException_examId_username_key" ON "ExamException"("examId", "username");

-- CreateIndex
CREATE UNIQUE INDEX "Report_publicId_key" ON "Report"("publicId");

-- CreateIndex
CREATE INDEX "Report_status_createdAt_idx" ON "Report"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Report_courseId_status_idx" ON "Report"("courseId", "status");

-- CreateIndex
CREATE INDEX "Blob_gitSha_idx" ON "Blob"("gitSha");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEvent_id_courseId_key" ON "CalendarEvent"("id", "courseId");
