/**
 * Fills a seeded database with a large amount of random, schema-valid data,
 * so the suite can be timed against a database the size of a production one.
 *
 * Everything it adds hangs off its own users, disciplines, editions and
 * courses, all named `bulk-*`; no existing row is changed. Rows go in through
 * better-sqlite3 in a single transaction, written the way Prisma stores each
 * type, so a failed run leaves the database as it was.
 *
 *     pnpm exec tsx test/fill/fill.ts --url file:/path/to.db [--scale 1] [--seed 1]
 */
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
	type Answer,
	paragraph,
	personName,
	type QuestionContent,
	type QuestionType,
	questionContent,
	type RunOutcome,
	runnerReport,
	sentence,
	TAGS,
} from "./content";
import { Random } from "./random";
import { databasePath, inserter, lastId, openSqlite } from "./sqlite";

export interface FillOptions {
	/// A `file:` URL, as in `DATABASE_URL`.
	url: string;
	/// Multiplies every count; 1 is about 300 courses and 300,000 submissions.
	scale?: number;
	seed?: number;
	/// The instant the dates are spread back from. Defaults to the current time.
	now?: Date;
}

/// Prefix of every username, slug and unique value the fill creates.
const BULK = "bulk-";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/// Weeks a course runs.
const COURSE_WEEKS = 16;

/// Editions, half a year apart, the newest one under way.
const TERMS = 6;

/// Year of the oldest bulk edition.
const BULK_FIRST_YEAR = 1901;

/// A syntactically valid hash that no password matches.
const PASSWORD_HASH =
	"$argon2id$v=19$m=19456,t=2,p=1$YnVsay1maWxsLXNhbHQ$2bWmL0vXc1sJmVbZ8t3n0c1m5m4Qk8m0mJ0mQy0c5uE";

/// Workers of the bulk code questions, apart from the ones a real worker polls.
const WORKERS = [
	[`${BULK}elm-test`, 0.8],
	[`${BULK}elm-slow`, 0.2],
] as const;

const WEEKDAYS = [
	"SUNDAY",
	"MONDAY",
	"TUESDAY",
	"WEDNESDAY",
	"THURSDAY",
	"FRIDAY",
	"SATURDAY",
] as const;

const NON_CODE_TYPES: readonly (readonly [QuestionType, number])[] = [
	["MULTIPLE_CHOICE", 30],
	["MULTIPLE_SELECTION", 12],
	["TRUE_FALSE", 12],
	["NUMERIC", 8],
	["ORDERING", 5],
	["ESSAY", 16],
	["SHORT_ANSWER", 7],
	["FILL_IN", 6],
	["CODE", 4],
];

/// Tables whose ids the fill assigns itself, because other rows point at them.
const KEYED = [
	"ApiKey",
	"Invite",
	"Attachment",
	"Course",
	"GradeColumn",
	"TimeSlot",
	"CalendarEvent",
	"RollCall",
	"Resource",
	"Repository",
	"QuestionRef",
	"QuestionData",
	"ResponseRef",
	"Submission",
	"Feedback",
	"Rubric",
	"RubricItem",
	"Exam",
	"Report",
	"AnswerEditHistory",
	"AnswerEditField",
] as const;

type Keyed = (typeof KEYED)[number];

/// A DateTime as the Prisma adapter writes it.
const iso = (ms: number) => new Date(ms).toISOString().replace("Z", "+00:00");
/// A calendar date, `YYYY-MM-DD`, as the date columns store it.
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const isoOrNull = (ms: number | null) => (ms === null ? null : iso(ms));
const bool = (value: boolean) => (value ? 1 : 0);
const json = (value: unknown) => JSON.stringify(value);
const pad = (n: number, width: number) => String(n).padStart(width, "0");
const sha256 = (data: string | Buffer) =>
	createHash("sha256").update(data).digest("hex");

/// The sha1 git gives an object of `type` with this body.
function gitSha(type: "blob" | "tree" | "commit", body: Buffer): string {
	return createHash("sha1")
		.update(`${type} ${body.length}\0`)
		.update(body)
		.digest("hex");
}

/// The Monday at 03:00 UTC of the week of `ms`.
function mondayOf(ms: number): number {
	const date = new Date(ms);
	const sinceMonday = (date.getUTCDay() + 6) % 7;
	return (
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) -
		sinceMonday * DAY +
		3 * HOUR
	);
}

function commonPrefix(a: string, b: string): number {
	let i = 0;
	while (i < a.length && i < b.length && a[i] === b[i]) i++;
	return i;
}

interface PoolQuestion {
	id: number;
	slug: string;
	/// `versionHash` of the latest version.
	version: string;
	content: QuestionContent;
}

interface RubricPlan {
	id: number;
	base: number;
	items: { id: number; group: string | null; value: number }[];
}

interface FeedbackPlan {
	ref: string;
	score: string;
	graderId: string | null;
	botId: string | null;
	feedback: string | null;
	notes: string | null;
	blanks: string | null;
	rubricId: number | null;
	items: number[];
	adjustment: string | null;
	at: number;
}

interface JobPlan {
	worker: string;
	state: "QUEUED" | "CLAIMED" | "DONE" | "FAILED" | "CANCELLED";
	claimedBy: string | null;
	leaseUntil: number | null;
	attempts: number;
	lastError: string | null;
}

interface SubmissionPlan {
	at: number;
	responseId: number;
	questionId: number;
	kind: "AUTOSAVE" | "SUBMIT" | "FINAL";
	status:
		| "PENDING_GRADE"
		| "WILL_NOT_GRADE"
		| "GRADED_AUTOMATICALLY"
		| "GRADED_MANUALLY"
		| "PRETEST_FAILED";
	payload: unknown;
	report: Record<string, unknown> | null;
	job: JobPlan | null;
	feedbacks: FeedbackPlan[];
	/// Whether the student may contest the grade of this answer.
	contestable: boolean;
}

/// One answer typed in a text box, for the edit history.
interface TypedAnswer {
	question: PoolQuestion;
	text: string;
	base: string;
	from: number;
	to: number;
}

/**
 * Fills the database at `url` with bulk data and returns the rows added per table.
 *
 * The same `seed` gives the same rows; only the dates follow `now`.
 *
 * @throws Error when the database already holds bulk data, or is not a `file:` URL.
 */
export async function fillDatabase(
	options: FillOptions,
): Promise<Record<string, number>> {
	const scale = options.scale ?? 1;
	if (!(scale > 0)) throw new Error(`scale must be positive, got ${scale}.`);
	const rng = new Random(options.seed ?? 1);
	const now = (options.now ?? new Date()).getTime();
	const db = openSqlite(databasePath(options.url));
	const counts: Record<string, number> = {};

	try {
		const filled = db
			.prepare(`SELECT 1 FROM "User" WHERE username LIKE ? LIMIT 1`)
			.get(`${BULK}%`);
		if (filled)
			throw new Error(
				`${options.url} already holds bulk data (users named "${BULK}*"): fill a fresh copy instead.`,
			);

		db.pragma("foreign_keys = ON");
		db.pragma("synchronous = OFF");
		db.pragma("cache_size = -200000");
		db.pragma("temp_store = MEMORY");
		db.exec("BEGIN IMMEDIATE");
		try {
			fill();
			db.exec("COMMIT");
		} catch (error) {
			db.exec("ROLLBACK");
			throw error;
		}
	} finally {
		db.close();
	}
	return counts;

	function fill(): void {
		const insert = (table: string, columns: readonly string[]) =>
			inserter(db, counts, table, columns);
		const ids = new Map<Keyed, number>(
			KEYED.map((table) => [table, lastId(db, table)]),
		);
		const nextId = (table: Keyed): number => {
			const id = (ids.get(table) ?? 0) + 1;
			ids.set(table, id);
			return id;
		};
		let serial = 0;
		/// 12 URL-safe characters, as `generateToken(9)` gives, unique by the serial in them.
		const publicId = () =>
			`bk${(serial++).toString(36).padStart(6, "0")}${rng.token(4)}`;
		/// 18 hexadecimal characters, as `randomBytes(9)` gives.
		const hexId = () =>
			`b0${(serial++).toString(16).padStart(8, "0")}${rng.hex(8)}`;
		const maybe = <T>(probability: number, value: () => T): T | null =>
			rng.chance(probability) ? value() : null;
		const rev = () => maybe(0.5, () => `${BULK}rev-${rng.token(6)}`);
		/// Nothing but schedules and leases is dated after `now`.
		const past = (ms: number) => Math.min(ms, now);

		const courseCount = Math.max(3, Math.round(300 * scale));
		const userCount = Math.max(60, Math.round(5000 * scale));
		const instructorCount = Math.max(2, Math.round(courseCount / 3));
		const adminCount = 1 + Math.round(4 * scale);
		const studentCount = userCount - instructorCount - adminCount;

		//
		// Users and what hangs off them
		//
		const insertUser = insert("User", [
			"username",
			"name",
			"passwordHash",
			"role",
			"email",
			"schoolId",
			"githubId",
			"image",
			"createdAt",
		]);
		const insertSession = insert("Session", [
			"tokenHash",
			"expiresAt",
			"createdAt",
			"username",
		]);
		const insertFeed = insert("CalendarFeed", [
			"username",
			"token",
			"lastUsedAt",
			"createdAt",
		]);
		const insertApiKey = insert("ApiKey", [
			"id",
			"publicId",
			"keyHash",
			"name",
			"kind",
			"createdById",
			"lastUsedAt",
			"createdAt",
		]);

		const students: string[] = [];
		const instructors: string[] = [];
		const admins: string[] = [];
		/// Bot name of each instructor that owns a `BOT` key.
		const bots = new Map<string, string>();
		const deviceOf = new Map<string, string>();

		const addUser = (username: string, role: string) => {
			const createdAt = now - rng.int(900 * DAY) - DAY;
			insertUser(
				username,
				personName(rng),
				PASSWORD_HASH,
				role,
				`${username}@bulk.codehood.local`,
				rng.chance(0.7) ? `${username}-school` : `!${username}`,
				rng.chance(0.5) ? `${username}-gh` : `!${username}`,
				maybe(0.15, () => `https://example.org/avatars/${username}.png`),
				iso(createdAt),
			);
			const sessions = rng.weighted([
				[0, 0.35],
				[1, 0.35],
				[2, 0.2],
				[4, 0.1],
			]);
			for (let i = 0; i < sessions; i++) {
				const at = now - rng.int(400 * DAY);
				insertSession(rng.hex(64), iso(at + 30 * DAY), iso(at), username);
			}
			if (rng.chance(0.1))
				insertFeed(
					username,
					`${BULK}${rng.token(27)}`,
					isoOrNull(maybe(0.6, () => now - rng.int(60 * DAY))),
					iso(createdAt + DAY),
				);
			return createdAt;
		};
		const addApiKey = (
			owner: string,
			kind: "CLI" | "BOT",
			name: string,
			createdAt: number,
		) =>
			insertApiKey(
				nextId("ApiKey"),
				publicId(),
				rng.hex(64),
				name,
				kind,
				owner,
				isoOrNull(maybe(0.7, () => now - rng.int(90 * DAY))),
				iso(createdAt),
			);

		for (let i = 0; i < adminCount; i++) {
			const username = `${BULK}a${pad(i + 1, 2)}`;
			addUser(username, "ADMIN");
			admins.push(username);
		}
		for (let i = 0; i < instructorCount; i++) {
			const username = `${BULK}i${pad(i + 1, 4)}`;
			const createdAt = addUser(username, "INSTRUCTOR");
			instructors.push(username);
			if (rng.chance(0.7)) addApiKey(username, "CLI", "Laptop", createdAt);
			if (i === 0 || rng.chance(0.4)) {
				const bot = `${BULK}runner-${i + 1}`;
				addApiKey(username, "BOT", bot, createdAt);
				bots.set(username, bot);
			}
		}
		for (let i = 0; i < studentCount; i++) {
			const username = `${BULK}s${pad(i + 1, 6)}`;
			const createdAt = addUser(username, "STUDENT");
			students.push(username);
			deviceOf.set(username, rng.hex(64));
			if (rng.chance(0.03)) addApiKey(username, "CLI", "CLI", createdAt);
		}
		const allBots = [...bots.values()];

		//
		// Disciplines and editions
		//
		const insertDiscipline = insert("Discipline", [
			"slug",
			"name",
			"createdAt",
			"updatedAt",
		]);
		const insertEdition = insert("Edition", [
			"slug",
			"name",
			"startDate",
			"endDate",
			"createdAt",
		]);
		const disciplines: string[] = [];
		const disciplineCount = Math.max(2, Math.round(courseCount / 6));
		for (let i = 0; i < disciplineCount; i++) {
			const slug = `${BULK}cs${pad(100 + i, 3)}`;
			const at = iso(now - 900 * DAY);
			insertDiscipline(slug, `Bulk ${rng.pick(TAGS)} ${100 + i}`, at, at);
			disciplines.push(slug);
		}
		/// Newest first; the first one started six weeks ago.
		const terms: { slug: string; startAt: number }[] = [];
		for (let k = 0; k < TERMS; k++) {
			const startAt = mondayOf(now) - (6 + 26 * k) * WEEK;
			// An edition slug is a year and a term, so the bulk ones take years no real edition has.
			const slug = `${BULK_FIRST_YEAR + Math.floor((TERMS - 1 - k) / 2)}-${((TERMS - 1 - k) % 2) + 1}`;
			insertEdition(
				slug,
				`Bulk term ${slug}`,
				day(startAt - 4 * WEEK),
				day(startAt + (COURSE_WEEKS + 1) * WEEK),
				iso(startAt - 8 * WEEK),
			);
			terms.push({ slug, startAt });
		}

		//
		// Courses
		//
		const insertCourse = insert("Course", [
			"id",
			"description",
			"disciplineSlug",
			"edition",
			"instructorId",
			"rev",
			"createdAt",
			"updatedAt",
			"startDate",
			"endDate",
		]);
		const insertEnrollment = insert("Enrollment", [
			"status",
			"username",
			"courseId",
			"createdAt",
		]);
		const insertSlot = insert("TimeSlot", [
			"id",
			"courseId",
			"slug",
			"title",
			"day",
			"startMin",
			"durationMin",
			"createdAt",
			"updatedAt",
		]);
		const insertEvent = insert("CalendarEvent", [
			"id",
			"kind",
			"title",
			"description",
			"courseId",
			"timeSlotId",
			"startAt",
			"durationMin",
			"week",
			"rev",
			"createdAt",
			"updatedAt",
		]);
		const insertRollCall = insert("RollCall", [
			"id",
			"eventId",
			"secret",
			"actsAsInvite",
			"closesAt",
			"createdAt",
			"updatedAt",
		]);
		const insertAttendance = insert("Attendance", [
			"rollCallId",
			"username",
			"source",
			"deviceHash",
			"joined",
			"note",
			"createdAt",
		]);
		const insertBlob = insert("Blob", [
			"hash",
			"size",
			"deletedAt",
			"gitSha",
			"createdAt",
		]);
		const insertAttachment = insert("Attachment", [
			"id",
			"hash",
			"filename",
			"mimeType",
			"uploaderUsername",
			"attachedToType",
			"attachedToId",
			"createdAt",
		]);
		const insertResource = insert("Resource", [
			"id",
			"type",
			"courseId",
			"slug",
			"title",
			"description",
			"data",
			"extra",
			"attachmentId",
			"eventId",
			"rev",
			"createdAt",
			"updatedAt",
		]);
		const insertRepository = insert("Repository", [
			"id",
			"courseId",
			"slug",
			"title",
			"head",
			"token",
			"zipHash",
			"createdAt",
			"updatedAt",
		]);
		const insertGitObject = insert("GitObject", [
			"repositoryId",
			"sha",
			"type",
			"content",
		]);
		const insertEventRepository = insert("CalendarEventRepository", [
			"courseId",
			"eventId",
			"repositoryId",
		]);
		const insertInvite = insert("Invite", [
			"id",
			"publicId",
			"tokenHash",
			"kind",
			"invitedRole",
			"maxUses",
			"email",
			"courseId",
			"createdById",
			"createdAt",
			"expiresAt",
		]);
		const insertRedemption = insert("InviteRedemption", [
			"inviteId",
			"username",
			"redeemedAt",
		]);
		const insertPassphrase = insert("Passphrase", [
			"courseId",
			"value",
			"expiresAt",
			"createdAt",
		]);
		const insertGradeColumn = insert("GradeColumn", [
			"id",
			"kind",
			"courseId",
			"slug",
			"title",
			"position",
			"releasedAt",
			"rev",
			"createdAt",
			"updatedAt",
		]);
		const insertGradeValue = insert("GradeValue", [
			"columnId",
			"username",
			"number",
			"label",
		]);
		const insertQuestionRef = insert("QuestionRef", [
			"id",
			"publicId",
			"slug",
			"status",
			"type",
			"courseId",
			"latestId",
			"rev",
			"worker",
			"attempts",
			"penalty",
			"createdAt",
			"updatedAt",
		]);
		const insertQuestionData = insert("QuestionData", [
			"id",
			"versionHash",
			"refId",
			"title",
			"stem",
			"publicPayload",
			"privatePayload",
			"createdAt",
		]);
		const insertQuestionTag = insert("QuestionTags", ["questionId", "tag"]);
		/// A question exists before its versions, so it learns the latest one afterwards.
		const setLatestVersion = db.prepare(
			`UPDATE "QuestionRef" SET "latestId" = ? WHERE id = ?`,
		);
		const insertExam = insert("Exam", [
			"id",
			"type",
			"status",
			"slug",
			"courseId",
			"title",
			"description",
			"preamble",
			"format",
			"scheduledAt",
			"durationMs",
			"allowCodeRun",
			"answerHistory",
			"extraTimeMs",
			"gradesReleasedAt",
			"authorId",
			"rev",
			"createdAt",
			"updatedAt",
		]);
		const insertExamTag = insert("ExamTags", ["examId", "tag"]);
		const insertExamQuestion = insert("QuestionsForExam", [
			"examId",
			"questionRefId",
			"version",
			"position",
		]);
		const insertException = insert("ExamException", [
			"examId",
			"username",
			"extraTimeMs",
			"scheduledAt",
			"note",
			"createdAt",
			"updatedAt",
		]);
		const insertSanction = insert("ExamAdjustment", [
			"publicId",
			"responseId",
			"questionRefId",
			"op",
			"value",
			"reason",
			"notes",
			"createdById",
			"createdAt",
			"updatedAt",
		]);
		const insertRubric = insert("Rubric", [
			"id",
			"examId",
			"questionRefId",
			"base",
			"sourceVersion",
			"createdAt",
			"updatedAt",
		]);
		const insertRubricItem = insert("RubricItem", [
			"id",
			"rubricId",
			"key",
			"group",
			"text",
			"value",
			"comment",
			"feedback",
			"position",
			"retiredAt",
			"createdAt",
			"updatedAt",
		]);
		const insertResponse = insert("ResponseRef", [
			"id",
			"publicId",
			"acceptingSubmissions",
			"closedAt",
			"authorId",
			"examId",
			"slotKey",
			"createdAt",
			"updatedAt",
		]);
		const insertSubmission = insert("Submission", [
			"id",
			"publicId",
			"automaticallyTriggered",
			"status",
			"kind",
			"responseId",
			"questionId",
			"payload",
			"runnerReport",
			"startedAt",
			"createdAt",
		]);
		const insertJob = insert("GradingJob", [
			"submissionId",
			"worker",
			"state",
			"claimedBy",
			"leaseUntil",
			"attempts",
			"lastError",
			"createdAt",
			"updatedAt",
		]);
		const insertFeedback = insert("Feedback", [
			"id",
			"ref",
			"submissionId",
			"score",
			"graderId",
			"botId",
			"feedback",
			"notes",
			"blanks",
			"createdAt",
			"updatedAt",
			"rubricId",
			"adjustment",
		]);
		const insertFeedbackItem = insert("FeedbackRubricItem", [
			"feedbackId",
			"itemId",
		]);
		const insertRegrade = insert("RegradeRequest", [
			"publicId",
			"submissionId",
			"message",
			"status",
			"reply",
			"feedbackId",
			"resolvedById",
			"resolvedAt",
			"createdAt",
			"updatedAt",
		]);
		const insertHistory = insert("AnswerEditHistory", [
			"id",
			"responseId",
			"editCount",
			"byteCount",
			"incompleteAt",
			"createdAt",
			"updatedAt",
		]);
		const setHistoryTotals = db.prepare(
			`UPDATE "AnswerEditHistory" SET "editCount" = ?, "byteCount" = ? WHERE id = ?`,
		);
		const insertField = insert("AnswerEditField", [
			"id",
			"historyId",
			"questionId",
			"field",
			"text",
			"revision",
			"nextSeq",
			"incompleteAt",
			"createdAt",
			"updatedAt",
		]);
		const insertBatch = insert("AnswerEditBatch", [
			"fieldId",
			"batchId",
			"revision",
			"firstSeq",
			"editCount",
			"sessionId",
			"timeOriginMs",
			"version",
			"edits",
			"contentHash",
			"byteCount",
			"baseReason",
			"baseText",
			"gapBefore",
			"lateMs",
			"receivedAt",
		]);
		const insertGap = insert("AnswerEditGap", [
			"fieldId",
			"reason",
			"clientId",
			"receivedAt",
		]);
		const insertReport = insert("Report", [
			"id",
			"publicId",
			"kind",
			"message",
			"status",
			"note",
			"url",
			"userAgent",
			"viewport",
			"authorId",
			"courseId",
			"triagedById",
			"triagedAt",
			"createdAt",
			"updatedAt",
		]);

		/// A blob whose bytes are not on disk, and its use by one owner.
		const attach = (
			owner: "RESOURCE" | "REPORT",
			ownerId: number,
			filename: string,
			mimeType: string,
			uploader: string | null,
			at: number,
		): number => {
			const hash = rng.hex(64);
			insertBlob(
				hash,
				rng.range(200, 4_000_000),
				isoOrNull(maybe(0.03, () => past(at + 30 * DAY))),
				maybe(0.5, () => rng.hex(40)),
				iso(at),
			);
			const id = nextId("Attachment");
			insertAttachment(
				id,
				hash,
				filename,
				mimeType,
				uploader,
				owner,
				ownerId,
				iso(at),
			);
			return id;
		};

		const addReport = (
			author: string,
			course: { id: number; url: string; instructor: string } | null,
			at: number,
		) => {
			const id = nextId("Report");
			const kind = course
				? rng.weighted([
						["CONTENT", 0.5],
						["BUG", 0.25],
						["SUGGESTION", 0.15],
						["OTHER", 0.1],
					] as const)
				: rng.pick(["BUG", "SUGGESTION", "OTHER"] as const);
			const status = rng.weighted([
				["OPEN", 0.4],
				["TRIAGED", 0.2],
				["RESOLVED", 0.3],
				["DISMISSED", 0.1],
			] as const);
			const triaged = status !== "OPEN";
			const fromPage = rng.chance(0.7);
			insertReport(
				id,
				hexId(),
				kind,
				paragraph(rng, 6, 40),
				status,
				triaged ? maybe(0.6, () => sentence(rng, 8)) : null,
				fromPage
					? `http://localhost:4321/${course ? course.url : "calendar"}`
					: null,
				fromPage
					? "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
					: null,
				fromPage ? rng.pick(["1280x720", "1920x1080", "390x844"]) : null,
				author,
				course?.id ?? null,
				triaged
					? course && kind === "CONTENT"
						? course.instructor
						: rng.pick(admins)
					: null,
				triaged ? iso(past(at + 2 * DAY)) : null,
				iso(at),
				iso(triaged ? past(at + 2 * DAY) : at),
			);
			if (rng.chance(0.08))
				attach("REPORT", id, "screenshot.png", "image/png", author, at);
		};

		const courseKeys = new Set<string>();
		for (let c = 0; c < courseCount; c++) {
			let discipline = "";
			let instructor = "";
			let term = terms[0] as (typeof terms)[number];
			do {
				discipline = rng.pick(disciplines);
				instructor = rng.pick(instructors);
				term = rng.chance(0.25)
					? (terms[0] as (typeof terms)[number])
					: rng.pick(terms.slice(1));
			} while (courseKeys.has(`${discipline}/${instructor}/${term.slug}`));
			courseKeys.add(`${discipline}/${instructor}/${term.slug}`);
			addCourse(discipline, instructor, term);
		}
		for (let i = 0; i < Math.round(courseCount / 2); i++)
			addReport(rng.pick(students), null, now - rng.int(700 * DAY));

		function addCourse(
			discipline: string,
			instructor: string,
			term: { slug: string; startAt: number },
		): void {
			const courseId = nextId("Course");
			const startAt = term.startAt;
			const endAt = startAt + COURSE_WEEKS * WEEK;
			const createdAt = startAt - rng.range(2, 20) * DAY;
			const ended = endAt < now;
			/// The last instant anything in this course happened.
			const horizon = Math.min(now, endAt);
			insertCourse(
				courseId,
				maybe(0.8, () => paragraph(rng, 8, 30)),
				discipline,
				term.slug,
				instructor,
				rev(),
				iso(createdAt),
				iso(createdAt + rng.int(10 * DAY)),
				day(startAt),
				day(endAt),
			);
			const bot = bots.get(instructor) ?? rng.pick(allBots);

			// Enrollments
			const enrolled = rng.sample(students, rng.range(20, 47));
			const active: string[] = [];
			const dropped: string[] = [];
			for (const username of enrolled) {
				const isDropped = rng.chance(0.08);
				(isDropped ? dropped : active).push(username);
				insertEnrollment(
					isDropped ? "DROPPED" : "ACTIVE",
					username,
					courseId,
					iso(startAt - 5 * DAY + rng.int(19 * DAY)),
				);
			}

			// Schedule
			const slots: {
				id: number;
				day: number;
				startMin: number;
				durationMin: number;
				lab: boolean;
			}[] = [];
			const days = rng
				.sample([1, 2, 3, 4, 5], rng.range(2, 3))
				.sort((a, b) => a - b);
			for (const [index, day] of days.entries()) {
				const id = nextId("TimeSlot");
				const lab = index === days.length - 1 && rng.chance(0.5);
				const name = (WEEKDAYS[day] as string).slice(0, 3).toLowerCase();
				const slot = {
					id,
					day,
					startMin: rng.pick([480, 600, 840, 960, 1140]),
					durationMin: rng.pick([90, 100, 120]),
					lab,
				};
				insertSlot(
					id,
					courseId,
					lab ? `${name}-lab` : name,
					maybe(0.7, () => (lab ? "Lab" : "Lecture")),
					WEEKDAYS[day] as string,
					slot.startMin,
					slot.durationMin,
					iso(createdAt),
					iso(createdAt),
				);
				slots.push(slot);
			}
			const events: { id: number; startAt: number }[] = [];
			let meeting = 0;
			for (let week = 0; week < COURSE_WEEKS; week++) {
				for (const slot of slots) {
					if (rng.chance(0.03)) continue;
					meeting++;
					const id = nextId("CalendarEvent");
					const at =
						startAt + week * WEEK + (slot.day - 1) * DAY + slot.startMin * MIN;
					const kind = rng.weighted([
						["REGULAR", 0.92],
						["HOLIDAY", 0.04],
						["CANCELLED", 0.04],
					] as const);
					insertEvent(
						id,
						kind,
						kind === "HOLIDAY"
							? "Holiday"
							: `${slot.lab ? "Lab" : "Lecture"} ${meeting}`,
						maybe(0.4, () => paragraph(rng, 5, 25)),
						courseId,
						slot.id,
						iso(at),
						slot.durationMin,
						week,
						rev(),
						iso(createdAt),
						iso(createdAt),
					);
					events.push({ id, startAt: at });
					if (kind !== "REGULAR" || at > now || !rng.chance(0.3)) continue;
					const rollCallId = nextId("RollCall");
					insertRollCall(
						rollCallId,
						id,
						rng.token(43),
						bool(rng.chance(0.05)),
						iso(at + 15 * MIN),
						iso(at),
						iso(at + 15 * MIN),
					);
					for (const username of active) {
						if (!rng.chance(0.72)) continue;
						const manual = rng.chance(0.07);
						insertAttendance(
							rollCallId,
							username,
							manual ? "MANUAL" : "CODE",
							manual ? null : (deviceOf.get(username) ?? null),
							rng.weighted([
								[null, 0.97],
								["ENROLLMENT", 0.025],
								["ACCOUNT", 0.005],
							] as const),
							manual ? maybe(0.5, () => "atestado") : null,
							iso(at + rng.int(14 * MIN)),
						);
					}
				}
			}

			// Resources
			const resources = rng.range(6, 18);
			for (let j = 0; j < resources; j++) {
				const id = nextId("Resource");
				const type = rng.weighted([
					["LINK", 0.35],
					["MD", 0.3],
					["CODE", 0.15],
					["FILE", 0.2],
				] as const);
				const at = createdAt + rng.int(Math.max(DAY, horizon - createdAt));
				const slug = `${type.toLowerCase()}-${pad(j + 1, 2)}`;
				const data =
					type === "LINK"
						? `https://example.org/bulk/${rng.token(8)}`
						: type === "MD"
							? `# ${sentence(rng, 3)}\n\n${paragraph(rng, 20, 200)}\n`
							: type === "CODE"
								? `def f(xs):\n    # ${sentence(rng, 5)}\n    return sum(xs)\n`
								: null;
				insertResource(
					id,
					type,
					courseId,
					slug,
					`${sentence(rng, rng.range(2, 5)).slice(0, -1)}`,
					maybe(0.6, () => sentence(rng, rng.range(5, 15))),
					data,
					type === "CODE" ? rng.pick(["python", "elm", "javascript"]) : null,
					type === "FILE"
						? attach(
								"RESOURCE",
								id,
								`${slug}.pdf`,
								"application/pdf",
								maybe(0.7, () => instructor),
								at,
							)
						: null,
					maybe(0.45, () => rng.pick(events).id),
					rev(),
					iso(at),
					iso(at),
				);
			}

			// Repositories
			const repositories = rng.weighted([
				[0, 0.35],
				[1, 0.45],
				[2, 0.2],
			]);
			for (let j = 0; j < repositories; j++)
				addRepository(courseId, j, createdAt, events);

			// Invites and passphrases
			const invites = rng.range(1, 3);
			for (let j = 0; j < invites; j++) {
				const id = nextId("Invite");
				const classroom = rng.chance(0.6);
				const at = startAt - rng.range(1, 10) * DAY;
				insertInvite(
					id,
					publicId(),
					rng.hex(64),
					classroom ? "CLASSROOM" : "PERSONAL",
					classroom || rng.chance(0.8) ? "STUDENT" : "INSTRUCTOR",
					classroom ? maybe(0.5, () => rng.range(30, 80)) : 1,
					classroom ? null : `${BULK}guest-${id}@bulk.codehood.local`,
					classroom || rng.chance(0.7) ? courseId : null,
					instructor,
					iso(at),
					iso(at + 30 * DAY),
				);
				const redeemers = classroom
					? active.filter(() => rng.chance(0.3))
					: rng.chance(0.5)
						? [rng.pick(enrolled)]
						: [];
				for (const username of redeemers)
					insertRedemption(id, username, iso(at + rng.int(20 * DAY)));
			}
			const passphrases = rng.range(0, 2);
			for (let j = 0; j < passphrases; j++) {
				const at = startAt + rng.int(4 * WEEK);
				insertPassphrase(
					courseId,
					`${BULK}${rng.pick(TAGS)}-${rng.pick(TAGS)}-${serial++}`,
					iso(at + 7 * DAY),
					iso(at),
				);
			}

			// Grade columns
			const columns = rng.sample(
				[
					["assignments", "Assignments", "NUMBER"],
					["participation", "Participation", "NUMBER"],
					["project", "Project", "NUMBER"],
					["final", "Final grade", "LABEL"],
					["concept", "Concept", "LABEL"],
				] as const,
				rng.range(2, 4),
			);
			for (const [position, [slug, title, kind]] of columns.entries()) {
				const id = nextId("GradeColumn");
				const at = startAt + rng.int(Math.max(DAY, horizon - startAt));
				insertGradeColumn(
					id,
					kind,
					courseId,
					slug,
					title,
					position,
					isoOrNull(maybe(0.6, () => at + DAY)),
					rev(),
					iso(at),
					iso(at + DAY),
				);
				for (const username of enrolled) {
					if (!rng.chance(0.85)) continue;
					insertGradeValue(
						id,
						username,
						kind === "NUMBER" ? rng.int(1001) / 10 : null,
						kind === "LABEL" ? rng.pick(["SS", "MS", "MM", "MI", "II"]) : null,
					);
				}
			}

			// Questions
			const workerPool: PoolQuestion[] = [];
			const plainPool: PoolQuestion[] = [];
			for (let j = 0; j < 20; j++) {
				const type = j < 4 ? "CODE" : rng.weighted(NON_CODE_TYPES);
				const worker = j < 4 ? rng.weighted(WORKERS) : null;
				const content = questionContent(rng, type, courseId * 100 + j, worker);
				const id = nextId("QuestionRef");
				const status =
					j < 10
						? "PUBLISHED"
						: rng.weighted([
								["PUBLISHED", 0.6],
								["DRAFT", 0.2],
								["HIDDEN", 0.1],
								["ARCHIVED", 0.1],
							] as const);
				const slug =
					type === "CODE"
						? content.title
						: `${type.toLowerCase().replace("_", "-")}-${pad(j + 1, 2)}`;
				const versions = rng.weighted([
					[1, 0.6],
					[2, 0.3],
					[3, 0.1],
				]);
				const at = createdAt + j * MIN;
				insertQuestionRef(
					id,
					publicId(),
					slug,
					status,
					type,
					courseId,
					null,
					rev(),
					content.worker,
					content.attempts,
					content.penalty,
					iso(at),
					iso(at + (versions - 1) * DAY),
				);
				let latestId = 0;
				for (let v = 1; v <= versions; v++) {
					latestId = nextId("QuestionData");
					const stem =
						v === versions ? content.stem : `${content.stem} (draft ${v})`;
					insertQuestionData(
						latestId,
						`v${v}`,
						id,
						content.title,
						stem,
						json({ ...content.publicPayload, stem }),
						json({ ...content.privatePayload, stem }),
						iso(at + (v - 1) * DAY),
					);
				}
				setLatestVersion.run(latestId, id);
				for (const tag of content.tags) insertQuestionTag(id, tag);
				if (status !== "PUBLISHED") continue;
				(worker ? workerPool : plainPool).push({
					id,
					slug,
					version: `v${versions}`,
					content,
				});
			}

			// Exams
			const types = rng.shuffle([
				"PRACTICE",
				"QUIZ",
				"QUIZ",
				"EXAM",
				"EXAM",
			] as const);
			const numbering = { PRACTICE: 0, QUIZ: 0, EXAM: 0 };
			const firstSlot = slots[0] as (typeof slots)[number];
			/// In a course under way, the first exam still ahead may be the one happening right now.
			let liveLeft = !ended && rng.chance(0.5);
			for (const [index, type] of types.entries()) {
				let scheduledAt =
					startAt +
					(2 + 3 * index) * WEEK +
					(firstSlot.day - 1) * DAY +
					firstSlot.startMin * MIN;
				const durationMs =
					type === "PRACTICE"
						? null
						: type === "QUIZ"
							? rng.pick([30, 45]) * MIN
							: rng.pick([100, 120]) * MIN;
				if (type !== "PRACTICE" && scheduledAt > now && liveLeft) {
					liveLeft = false;
					scheduledAt = now - rng.range(5, 25) * MIN;
				}
				numbering[type]++;
				addExam({
					courseId,
					instructor,
					bot,
					type,
					number: numbering[type],
					scheduledAt,
					durationMs,
					ended,
					active,
					dropped,
					workerPool,
					plainPool,
				});
			}

			// Reports
			const url = `${discipline}/${instructor}_${term.slug}`;
			const reports = rng.range(1, 6);
			for (let j = 0; j < reports; j++)
				addReport(
					rng.chance(0.9) ? rng.pick(enrolled) : instructor,
					{ id: courseId, url, instructor },
					startAt + rng.int(Math.max(DAY, horizon - startAt)),
				);
		}

		/// A repository with real git objects: one to three commits of a small tree.
		function addRepository(
			courseId: number,
			index: number,
			createdAt: number,
			events: { id: number; startAt: number }[],
		): void {
			const id = nextId("Repository");
			const slug = `lab-${pad(index + 1, 2)}`;
			const token = `bulk${rng.token(28)}`;
			const commits = rng.chance(0.12) ? 0 : rng.range(1, 3);
			const stored = new Set<string>();
			const objects: [sha: string, type: string, body: Buffer][] = [];
			const blob = (filename: string, mimeType: string, text: string) => {
				const bytes = Buffer.from(text);
				const sha = gitSha("blob", bytes);
				if (!stored.has(sha)) {
					stored.add(sha);
					const hash = sha256(bytes);
					insertBlob(hash, bytes.length, null, sha, iso(createdAt));
					insertAttachment(
						nextId("Attachment"),
						hash,
						filename,
						mimeType,
						null,
						"REPOSITORY",
						id,
						iso(createdAt),
					);
				}
				return sha;
			};
			const tree = (entries: [mode: string, name: string, sha: string][]) => {
				const body = Buffer.concat(
					entries.flatMap(([mode, name, sha]) => [
						Buffer.from(`${mode} ${name}\0`),
						Buffer.from(sha, "hex"),
					]),
				);
				const sha = gitSha("tree", body);
				if (!stored.has(sha)) {
					stored.add(sha);
					objects.push([sha, "TREE", body]);
				}
				return sha;
			};
			const title = rng.chance(0.7) ? `Lab ${sentence(rng, 2)}` : slug;
			const readme = blob(
				"readme.md",
				"text/markdown",
				`# ${title}\n\n${paragraph(rng, 10, 60)}\n\n${token}\n`,
			);
			const docs = tree([
				[
					"100644",
					"notes.md",
					blob(
						"notes.md",
						"text/markdown",
						`${paragraph(rng, 10, 80)}\n${id}\n`,
					),
				],
			]);
			let head: string | null = null;
			let source = `# ${token}\n\ndef main():\n    pass\n`;
			for (let k = 0; k < commits; k++) {
				source += `    # ${sentence(rng, 6)}\n`;
				const root = tree([
					["100644", "README.md", readme],
					["40000", "docs", docs],
					["100644", "main.py", blob("main.py", "text/x-python", source)],
				]);
				const seconds = Math.floor((createdAt + k * DAY) / 1000);
				const signature = `Codehood <system@codehood> ${seconds} +0000`;
				const body: Buffer = Buffer.from(
					`tree ${root}\n${head ? `parent ${head}\n` : ""}author ${signature}\ncommitter ${signature}\n\n${sentence(rng, 4)}\n`,
				);
				head = gitSha("commit", body);
				objects.push([head, "COMMIT", body]);
			}
			let zipHash: string | null = null;
			if (head && rng.chance(0.1)) {
				zipHash = rng.hex(64);
				insertBlob(zipHash, rng.range(500, 9000), null, null, iso(createdAt));
			}
			insertRepository(
				id,
				courseId,
				slug,
				title,
				head,
				token,
				zipHash,
				iso(createdAt),
				iso(createdAt + commits * DAY),
			);
			for (const [sha, type, body] of objects)
				insertGitObject(id, sha, type, body);
			if (!head) return;
			for (const event of rng.sample(events, rng.range(0, 3)))
				insertEventRepository(courseId, event.id, id);
		}

		function addExam(input: {
			courseId: number;
			instructor: string;
			bot: string;
			type: "PRACTICE" | "QUIZ" | "EXAM";
			number: number;
			scheduledAt: number;
			durationMs: number | null;
			ended: boolean;
			active: string[];
			dropped: string[];
			workerPool: PoolQuestion[];
			plainPool: PoolQuestion[];
		}): void {
			const { type, scheduledAt, durationMs, instructor } = input;
			const examId = nextId("Exam");
			const practice = type === "PRACTICE";
			const endAt = scheduledAt + (durationMs ?? 0);
			const status = practice
				? scheduledAt > now
					? rng.pick(["SCHEDULED", "SCHEDULED", "DRAFT"] as const)
					: input.ended
						? rng.weighted([
								["COMPLETED", 0.5],
								["ONGOING", 0.4],
								["ARCHIVED", 0.1],
							] as const)
						: ("ONGOING" as const)
				: scheduledAt > now
					? rng.pick(["SCHEDULED", "SCHEDULED", "DRAFT"] as const)
					: endAt > now
						? ("ONGOING" as const)
						: rng.weighted([
								["COMPLETED", 0.92],
								["ARCHIVED", 0.06],
								["ONGOING", 0.02],
							] as const);
			const answered = status !== "DRAFT" && status !== "SCHEDULED";
			const done = status === "COMPLETED" || status === "ARCHIVED";
			const answerHistory = rng.weighted([
				[null, 0.8],
				[1, 0.1],
				[0, 0.1],
			]);
			const createdAt = Math.min(
				scheduledAt - rng.range(7, 21) * DAY,
				now - rng.range(1, 5) * DAY,
			);
			insertExam(
				examId,
				type,
				status,
				`${type.toLowerCase()}-${pad(input.number, 2)}`,
				input.courseId,
				`${type.charAt(0)}${type.slice(1).toLowerCase()} ${input.number}: ${rng.pick(TAGS)}`,
				maybe(0.7, () => sentence(rng, rng.range(5, 14))),
				maybe(0.4, () => paragraph(rng, 10, 50)),
				rng.weighted([
					["MARKDOWN", 0.9],
					["PLAINTEXT", 0.07],
					["HTML", 0.03],
				]),
				practice && answered && rng.chance(0.6) ? null : iso(scheduledAt),
				durationMs,
				rng.weighted([
					[null, 0.8],
					[1, 0.1],
					[0, 0.1],
				]),
				answerHistory,
				rng.chance(0.05) ? 10 * MIN : 0,
				type === "EXAM" && status === "COMPLETED" && rng.chance(0.7)
					? iso(past(endAt + rng.range(1, 10) * DAY))
					: null,
				instructor,
				rev(),
				iso(createdAt),
				iso(Math.max(createdAt, past(endAt + DAY))),
			);
			for (const tag of new Set([rng.pick(TAGS), rng.pick(TAGS)]))
				insertExamTag(examId, tag);

			const questions = [
				...(rng.chance(0.85) ? rng.sample(input.workerPool, 1) : []),
				...rng.sample(input.plainPool, rng.range(3, 5)),
			];
			for (const [position, question] of rng.shuffle(questions).entries())
				insertExamQuestion(examId, question.id, question.version, position);

			if (status !== "DRAFT")
				for (const username of [...input.active, ...input.dropped]) {
					if (!rng.chance(0.025)) continue;
					const makeup = rng.chance(0.4);
					insertException(
						examId,
						username,
						makeup && rng.chance(0.5) ? 0 : rng.pick([10, 20, 30, 60]) * MIN,
						makeup ? iso(scheduledAt + 2 * DAY) : null,
						maybe(0.7, () => rng.pick(["atestado", "Accommodation on file"])),
						iso(createdAt + DAY),
						iso(createdAt + DAY),
					);
				}
			if (!answered) return;

			// Rubrics of the questions graded by hand.
			const rubrics = new Map<number, RubricPlan>();
			for (const question of questions) {
				const { type: kind, worker } = question.content;
				if (worker || (kind !== "ESSAY" && kind !== "CODE")) continue;
				if (!rng.chance(0.55)) continue;
				const id = nextId("Rubric");
				const deducts = rng.chance(0.2);
				insertRubric(
					id,
					examId,
					question.id,
					deducts ? "1" : "0",
					maybe(0.5, () => "v1"),
					iso(endAt),
					iso(past(endAt + DAY)),
				);
				const plan: RubricPlan = { id, base: deducts ? 1 : 0, items: [] };
				const groups = [
					null,
					null,
					"Clareza",
					"Recursão/Certa",
					"Recursão/Errada",
				];
				const items = rng.range(3, 6);
				for (let position = 0; position < items; position++) {
					const itemId = nextId("RubricItem");
					const group = rng.pick(groups);
					const value =
						(deducts ? -1 : 1) * rng.pick([0.1, 0.2, 0.3, 0.4, 0.5]);
					const retired = rng.chance(0.05);
					insertRubricItem(
						itemId,
						id,
						`item-${position + 1}`,
						group,
						sentence(rng, rng.range(3, 8)),
						String(value),
						maybe(0.3, () => sentence(rng, 6)),
						maybe(0.6, () => sentence(rng, 7)),
						position,
						retired ? iso(past(endAt + 2 * DAY)) : null,
						iso(endAt),
						iso(endAt),
					);
					if (!retired) plan.items.push({ id: itemId, group, value });
				}
				rubrics.set(question.id, plan);
			}

			// Attempts and their answers, inserted in the order the class sent them.
			const plans: SubmissionPlan[] = [];
			const histories: {
				responseId: number;
				from: number;
				to: number;
				typed: TypedAnswer[];
			}[] = [];
			const live = status === "ONGOING" && !practice && endAt > now;
			const tracked = answerHistory === null ? !practice : answerHistory === 1;
			for (const username of [...input.active, ...input.dropped]) {
				const isActive = input.active.includes(username);
				if (!rng.chance(practice ? 0.5 : isActive ? 0.85 : 0.3)) continue;
				const attempts = practice
					? rng.weighted([
							[1, 0.6],
							[2, 0.25],
							[3, 0.15],
						])
					: 1;
				for (let attempt = 0; attempt < attempts; attempt++) {
					const responseId = nextId("ResponseRef");
					const from = practice
						? Math.min(
								scheduledAt + rng.int(30 * DAY) + attempt * DAY,
								now - (attempts - attempt) * HOUR,
							)
						: scheduledAt + rng.int(live ? 4 * MIN : 10 * MIN);
					const open = live
						? rng.chance(0.8)
						: practice && !done && attempt === attempts - 1 && rng.chance(0.15);
					const to = open
						? Math.max(from + MIN, now)
						: practice
							? from + rng.range(10, 60) * MIN
							: live
								? from + rng.int(Math.max(MIN, now - from))
								: from +
									Math.round((durationMs ?? HOUR) * (0.4 + 0.6 * rng.next()));
					const typed: TypedAnswer[] = [];
					const before = plans.length;
					for (const question of questions) {
						if (!rng.chance(0.93)) continue;
						planAnswers(plans, typed, {
							question,
							responseId,
							from,
							to,
							closed: !open,
							graded: !open && (done || practice),
							instructor,
							bot: input.bot,
							rubric: rubrics.get(question.id) ?? null,
							contestable: status === "COMPLETED" && !practice,
							gradedAt: past(endAt + rng.range(1, 6) * DAY),
						});
					}
					const last = plans.length > before ? plans[plans.length - 1] : null;
					insertResponse(
						responseId,
						publicId(),
						bool(open),
						open ? null : iso(to),
						username,
						examId,
						practice ? Math.floor(from / 1000) : 0,
						iso(from),
						iso(open ? (last?.at ?? from) : to),
					);
					if (!open && !practice && rng.chance(0.01)) {
						const at = iso(to + DAY);
						insertSanction(
							publicId(),
							responseId,
							null,
							"FACTOR",
							"0",
							"copied",
							"same code as a classmate",
							instructor,
							at,
							at,
						);
					}
					if (tracked && typed.length > 0 && rng.chance(0.35))
						histories.push({ responseId, from, to, typed });
				}
			}

			plans.sort((a, b) => a.at - b.at);
			for (const plan of plans) writeSubmission(plan, instructor);
			for (const history of histories) writeHistory(history);
		}

		/// Plans every submission of one question in one attempt.
		function planAnswers(
			plans: SubmissionPlan[],
			typed: TypedAnswer[],
			ctx: {
				question: PoolQuestion;
				responseId: number;
				from: number;
				to: number;
				closed: boolean;
				graded: boolean;
				instructor: string;
				bot: string;
				rubric: RubricPlan | null;
				contestable: boolean;
				gradedAt: number;
			},
		): void {
			const { content } = ctx.question;
			const final = content.answer(rng);
			const steps: {
				kind: SubmissionPlan["kind"];
				answer: Answer;
				/// How much of the answer was typed, in (0, 1].
				part: number;
			}[] = [];
			const drafts = (answer: Answer, count: number) => {
				for (let i = 0; i < count; i++)
					steps.push({
						kind: "AUTOSAVE",
						answer: answer.text === undefined ? content.answer(rng) : answer,
						part: (i + 1) / (count + 1),
					});
			};
			const textual = final.text !== undefined;
			// A few students leave the editor saving for the whole exam.
			const restless = textual && rng.chance(0.002) ? rng.range(150, 600) : 0;

			if (content.worker) {
				const sends = Math.min(
					content.attempts ?? 4,
					rng.weighted([
						[1, 0.45],
						[2, 0.3],
						[3, 0.15],
						[4, 0.1],
					]),
				);
				for (let k = 0; k < sends; k++) {
					const answer = k === sends - 1 ? final : content.answer(rng);
					drafts(answer, (k === 0 ? restless : 0) + rng.geometric(0.6));
					steps.push({ kind: "SUBMIT", answer, part: 1 });
				}
				if (ctx.closed && rng.chance(0.12)) {
					const answer = content.answer(rng);
					drafts(answer, 1);
					steps.push({ kind: "FINAL", answer, part: 1 });
				}
			} else {
				drafts(final, restless + rng.geometric(textual ? 0.5 : 0.75));
				steps.push({ kind: "AUTOSAVE", answer: final, part: 1 });
			}

			const times = steps
				.map(() => ctx.from + rng.int(Math.max(1, ctx.to - ctx.from)))
				.sort((a, b) => a - b);
			const lastSend = steps.findLastIndex((step) => step.kind !== "AUTOSAVE");
			for (const [index, step] of steps.entries()) {
				const { answer } = step;
				let payload = answer.payload;
				if (step.part < 1 && answer.text !== undefined) {
					const kept = commonPrefix(answer.base ?? "", answer.text);
					payload = answer.text.slice(
						0,
						kept + Math.ceil((answer.text.length - kept) * step.part),
					);
				}
				const plan: SubmissionPlan = {
					at: step.kind === "FINAL" ? ctx.to : (times[index] as number),
					responseId: ctx.responseId,
					questionId: ctx.question.id,
					kind: step.kind,
					status: "PENDING_GRADE",
					payload,
					report: null,
					job: null,
					feedbacks: [],
					contestable: false,
				};
				plans.push(plan);
				if (step.kind !== "AUTOSAVE" && content.worker)
					gradeByWorker(plan, answer, index === lastSend, ctx);
				else if (index === steps.length - 1 && !content.worker)
					gradeAnswer(plan, answer, ctx);
			}
			if (
				final.text !== undefined &&
				(content.type === "ESSAY" || content.type === "CODE")
			)
				typed.push({
					question: ctx.question,
					text: final.text,
					base: final.base ?? "",
					from: ctx.from,
					to: ctx.to,
				});
		}

		/// The grading job of a sent answer and, when a worker finished it, its result.
		function gradeByWorker(
			plan: SubmissionPlan,
			answer: Answer,
			newest: boolean,
			ctx: {
				question: PoolQuestion;
				closed: boolean;
				bot: string;
				contestable: boolean;
			},
		): void {
			const state = !newest
				? rng.weighted([
						["DONE", 0.96],
						["CANCELLED", 0.04],
					] as const)
				: ctx.closed
					? rng.weighted([
							["DONE", 0.95],
							["FAILED", 0.03],
							["QUEUED", 0.01],
							["CLAIMED", 0.01],
						] as const)
					: rng.weighted([
							["DONE", 0.7],
							["QUEUED", 0.15],
							["CLAIMED", 0.1],
							["FAILED", 0.05],
						] as const);
			const held = state !== "QUEUED" && state !== "CANCELLED";
			const retried = state === "DONE" && rng.chance(0.03);
			plan.job = {
				worker: ctx.question.content.worker ?? "",
				state,
				claimedBy: held ? ctx.bot : null,
				leaseUntil: state === "CLAIMED" ? now + rng.range(1, 30) * DAY : null,
				attempts: state === "FAILED" ? 3 : retried ? 1 : 0,
				lastError:
					state === "FAILED"
						? "elm-test exited with status 137 (killed, out of memory)"
						: retried
							? "worker timed out"
							: null,
			};
			if (state !== "DONE") return;
			const outcome: RunOutcome =
				answer.score === "1"
					? "pass"
					: rng.chance(newest ? 0.15 : 0.4)
						? "pretest"
						: "hidden";
			plan.report = runnerReport(outcome);
			if (outcome === "pretest") {
				plan.status = "PRETEST_FAILED";
				return;
			}
			plan.status = "GRADED_AUTOMATICALLY";
			plan.contestable = newest && ctx.contestable;
			plan.feedbacks.push({
				ref: "auto-1",
				score: answer.score,
				graderId: null,
				botId: ctx.bot,
				feedback:
					outcome === "pass" ? "All tests passed." : "1 of 4 tests failed.",
				notes: maybe(0.04, () => sentence(rng, 9)),
				blanks: null,
				rubricId: null,
				items: [],
				adjustment: null,
				at: plan.at + rng.range(2, 40) * 1000,
			});
		}

		/// The grade of the counting answer of a question no worker grades.
		function gradeAnswer(
			plan: SubmissionPlan,
			answer: Answer,
			ctx: {
				question: PoolQuestion;
				closed: boolean;
				graded: boolean;
				instructor: string;
				rubric: RubricPlan | null;
				contestable: boolean;
				to: number;
				gradedAt: number;
			},
		): void {
			if (!ctx.closed) return;
			const { type } = ctx.question.content;
			const byHand = type === "ESSAY" || type === "CODE";
			const feedback: FeedbackPlan = {
				ref: "auto-1",
				score: answer.score,
				graderId: null,
				botId: "auto",
				feedback: null,
				notes: null,
				blanks: null,
				rubricId: null,
				items: [],
				adjustment: null,
				at: ctx.to + 1000,
			};
			if (!byHand) {
				if (type === "ORDERING" && rng.chance(0.2)) return;
				if (type === "FILL_IN" && rng.chance(0.2)) {
					if (!ctx.graded) return;
					const score = rng.pick([0, 0.5, 0.8, 1]);
					plan.status = "GRADED_MANUALLY";
					feedback.ref = "manual-1";
					feedback.graderId = ctx.instructor;
					feedback.botId = null;
					feedback.score = String(Math.round((0.5 + score / 2) * 100) / 100);
					feedback.blanks = json({
						smaller: rng.chance(0.5)
							? { score, comment: sentence(rng, 6) }
							: { score },
					});
					feedback.at = ctx.gradedAt;
				} else plan.status = "GRADED_AUTOMATICALLY";
			} else {
				if (!ctx.graded) return;
				const roll = rng.next();
				if (roll > 0.78) return;
				if (roll > 0.75) {
					plan.status = "WILL_NOT_GRADE";
					return;
				}
				plan.status = "GRADED_MANUALLY";
				feedback.ref = "manual-1";
				feedback.graderId = ctx.instructor;
				feedback.botId = null;
				feedback.feedback = maybe(0.6, () => sentence(rng, rng.range(4, 16)));
				feedback.at = ctx.gradedAt;
				const rubric = ctx.rubric;
				if (rubric && rubric.items.length > 0) {
					const taken = new Set<string>();
					let score = rubric.base;
					for (const item of rng.sample(rubric.items, rng.range(1, 3))) {
						const family = item.group?.split("/")[0];
						if (family !== undefined && taken.has(family)) continue;
						if (family !== undefined) taken.add(family);
						feedback.items.push(item.id);
						score += item.value;
					}
					const adjustment = rng.chance(0.1) ? rng.pick([0.05, 0.1, -0.1]) : 0;
					feedback.ref = "rubric-1";
					feedback.rubricId = rubric.id;
					feedback.adjustment = adjustment === 0 ? null : String(adjustment);
					feedback.score = String(
						Math.round(Math.min(1, Math.max(0, score + adjustment)) * 100) /
							100,
					);
				}
			}
			plan.feedbacks.push(feedback);
			plan.contestable = ctx.contestable;
		}

		function writeSubmission(plan: SubmissionPlan, instructor: string): void {
			const id = nextId("Submission");
			insertSubmission(
				id,
				publicId(),
				bool(
					plan.kind === "FINAL" ||
						(plan.kind === "AUTOSAVE" && rng.chance(0.3)),
				),
				plan.status,
				plan.kind,
				plan.responseId,
				plan.questionId,
				json(plan.payload),
				plan.report ? json(plan.report) : null,
				isoOrNull(maybe(0.3, () => plan.at - rng.range(5, 300) * 1000)),
				iso(plan.at),
			);
			if (plan.job)
				insertJob(
					id,
					plan.job.worker,
					plan.job.state,
					plan.job.claimedBy,
					isoOrNull(plan.job.leaseUntil),
					plan.job.attempts,
					plan.job.lastError,
					iso(plan.at),
					iso(plan.at + (plan.job.state === "QUEUED" ? 0 : 3000)),
				);
			const writeFeedback = (feedback: FeedbackPlan): number => {
				const feedbackId = nextId("Feedback");
				insertFeedback(
					feedbackId,
					feedback.ref,
					id,
					feedback.score,
					feedback.graderId,
					feedback.botId,
					feedback.feedback,
					feedback.notes,
					feedback.blanks,
					iso(feedback.at),
					iso(feedback.at),
					feedback.rubricId,
					feedback.adjustment,
				);
				for (const item of feedback.items) insertFeedbackItem(feedbackId, item);
				return feedbackId;
			};
			let graded = plan.at;
			for (const feedback of plan.feedbacks) {
				writeFeedback(feedback);
				graded = Math.max(graded, feedback.at);
			}
			if (!plan.contestable || !rng.chance(0.012)) return;
			const status = rng.weighted([
				["OPEN", 0.4],
				["ACCEPTED", 0.35],
				["REJECTED", 0.25],
			] as const);
			const askedAt = past(graded + rng.range(1, 72) * HOUR);
			const resolvedAt = past(askedAt + rng.range(1, 96) * HOUR);
			const resolved = status !== "OPEN";
			insertRegrade(
				hexId(),
				id,
				sentence(rng, rng.range(6, 25)),
				status,
				resolved ? sentence(rng, rng.range(4, 15)) : null,
				status === "ACCEPTED"
					? writeFeedback({
							ref: "manual-2",
							score: rng.pick(["0.5", "0.8", "1"]),
							graderId: instructor,
							botId: null,
							feedback: sentence(rng, 6),
							notes: null,
							blanks: null,
							rubricId: null,
							items: [],
							adjustment: null,
							at: resolvedAt,
						})
					: null,
				resolved ? instructor : null,
				resolved ? iso(resolvedAt) : null,
				iso(askedAt),
				iso(resolved ? resolvedAt : askedAt),
			);
		}

		/// The edit history of one attempt: each typed answer as batches of edits that replay to it.
		function writeHistory(history: {
			responseId: number;
			from: number;
			to: number;
			typed: TypedAnswer[];
		}): void {
			const historyId = nextId("AnswerEditHistory");
			insertHistory(
				historyId,
				history.responseId,
				0,
				0,
				isoOrNull(maybe(0.01, () => history.to)),
				iso(history.from),
				iso(history.to),
			);
			let editTotal = 0;
			let byteTotal = 0;
			for (const answer of history.typed) {
				const kept = commonPrefix(answer.base, answer.text);
				const edits: [number, number, number, number, string, number, null][] =
					[];
				let text = answer.base;
				/// The text after each edit.
				const snapshots: string[] = [];
				if (answer.base.length > kept) {
					edits.push([0, 60, kept, answer.base.length - kept, "", 2, null]);
					text = text.slice(0, kept);
					snapshots.push(text);
				}
				const words = answer.text.slice(kept).match(/\s*\S+\s*/g) ?? [];
				for (let w = 0; w < words.length; ) {
					const pasted = rng.chance(0.04);
					const chunk = words.slice(w, w + (pasted ? 6 : 1)).join("");
					w += pasted ? 6 : 1;
					edits.push([
						edits.length === 0 ? 0 : rng.range(150, 2500),
						pasted ? 0 : 70 * chunk.length,
						text.length,
						0,
						chunk,
						pasted ? 1 : 0,
						null,
					]);
					text += chunk;
					snapshots.push(text);
				}
				if (edits.length === 0) continue;

				const fieldId = nextId("AnswerEditField");
				const batches = Math.min(edits.length, rng.range(1, 4));
				const size = Math.ceil(edits.length / batches);
				const session = `tab-${rng.token(6)}`;
				insertField(
					fieldId,
					historyId,
					answer.question.id,
					"answer",
					text,
					Math.ceil(edits.length / size),
					edits.length,
					isoOrNull(maybe(0.01, () => answer.to)),
					iso(answer.from),
					iso(answer.to),
				);
				let revision = 0;
				for (let first = 0; first < edits.length; first += size) {
					const slice = edits.slice(first, first + size);
					const snapshot = snapshots[first + slice.length - 1] ?? text;
					const batchId = `${session}-${revision + 1}`;
					const timeOriginMs = rng.range(500, 600_000);
					const stored = json(slice);
					const item = json({
						question: answer.question.slug,
						field: "answer",
						batch: {
							version: 1,
							batchId,
							sessionId: session,
							timeOriginMs,
							baseRevision: revision,
							firstSeq: first,
							edits: slice,
							snapshot,
							...(revision === 0
								? { base: { reason: "start", text: answer.base } }
								: {}),
						},
					});
					const bytes = Buffer.byteLength(item);
					revision++;
					insertBatch(
						fieldId,
						batchId,
						revision,
						first,
						slice.length,
						session,
						timeOriginMs,
						1,
						stored,
						sha256(item),
						bytes,
						revision === 1 ? "start" : null,
						revision === 1 ? answer.base : null,
						null,
						maybe(0.02, () => rng.range(100, 20_000)),
						iso(
							answer.from +
								Math.round(((answer.to - answer.from) * revision) / batches),
						),
					);
					editTotal += slice.length;
					byteTotal += bytes;
				}
				if (rng.chance(0.04))
					insertGap(
						fieldId,
						rng.pick(["input-lost", "storage-full", "monitor-error"]),
						maybe(0.7, () => rng.token(12)),
						iso(answer.from + rng.int(Math.max(1, answer.to - answer.from))),
					);
			}
			setHistoryTotals.run(editTotal, byteTotal, historyId);
		}
	}
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	const { values } = parseArgs({
		options: {
			url: { type: "string" },
			scale: { type: "string", default: "1" },
			seed: { type: "string", default: "1" },
		},
	});
	if (!values.url) {
		console.error(
			"Usage: tsx test/fill/fill.ts --url file:/path/to.db [--scale 1] [--seed 1]",
		);
		process.exit(2);
	}
	const started = performance.now();
	const counts = await fillDatabase({
		url: values.url,
		scale: Number(values.scale),
		seed: Number(values.seed),
	}).catch((error: Error) => {
		console.error(`[fill] ${error.message}`);
		process.exit(1);
	});
	let total = 0;
	for (const [table, rows] of Object.entries(counts)) {
		console.log(`${table.padEnd(26)}${String(rows).padStart(9)}`);
		total += rows;
	}
	console.log(`${"total".padEnd(26)}${String(total).padStart(9)}`);
	console.log(`[fill] ${((performance.now() - started) / 1000).toFixed(1)} s`);
}
