-- CreateTable
CREATE TABLE "Assignment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "courseId" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "opensAt" DATETIME,
    "dueAt" DATETIME NOT NULL,
    "closesAt" DATETIME,
    "teamMin" INTEGER NOT NULL DEFAULT 1,
    "teamMax" INTEGER NOT NULL DEFAULT 1,
    "teamsLockAt" DATETIME,
    "templateId" INTEGER,
    "restrictions" JSONB,
    "checkpoints" JSONB,
    "rev" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Assignment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Assignment_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Repository" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Team" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "publicId" TEXT NOT NULL,
    "assignmentId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "joinCode" TEXT,
    "baseSha" TEXT,
    "dueAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Team_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "assignmentId" INTEGER NOT NULL,
    "teamId" INTEGER NOT NULL,
    "username" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "tempToken" TEXT,
    "tempTokenExpiresAt" DATETIME,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("teamId", "username"),
    CONSTRAINT "TeamMember_teamId_assignmentId_fkey" FOREIGN KEY ("teamId", "assignmentId") REFERENCES "Team" ("id", "assignmentId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeamMember_username_fkey" FOREIGN KEY ("username") REFERENCES "User" ("username") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TeamPush" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "teamId" INTEGER NOT NULL,
    "username" TEXT,
    "oldSha" TEXT,
    "newSha" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TeamPush_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeamPush_username_fkey" FOREIGN KEY ("username") REFERENCES "User" ("username") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Assignment_courseId_slug_key" ON "Assignment"("courseId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Team_publicId_key" ON "Team"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_joinCode_key" ON "Team"("joinCode");

-- CreateIndex
CREATE UNIQUE INDEX "Team_id_assignmentId_key" ON "Team"("id", "assignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_assignmentId_name_key" ON "Team"("assignmentId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_token_key" ON "TeamMember"("token");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_tempToken_key" ON "TeamMember"("tempToken");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_assignmentId_username_key" ON "TeamMember"("assignmentId", "username");

-- CreateIndex
CREATE INDEX "TeamPush_teamId_createdAt_idx" ON "TeamPush"("teamId", "createdAt");

-- CreateIndex
CREATE INDEX "Submission_responseId_questionId_kind_createdAt_idx" ON "Submission"("responseId", "questionId", "kind", "createdAt");
