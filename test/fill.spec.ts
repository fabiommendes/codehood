/**
 * The bulk fill (`test/fill/fill.ts`): it adds rows of every table to a copy of
 * the seeded database, leaves the seeded rows as they were, and writes rows
 * that Prisma and the application's own validators read back.
 *
 * It works on copies of the seeded database `test/run.ts` prepares, which no
 * worker writes to, so what other spec files did to the worker's database
 * does not matter.
 */
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/db/client";
import { assertResponse, publicForm, questionDocument } from "@/mdq";
import { publicQuestionSchema } from "@/mdq/public-schema";
import { replayEdits } from "@/services/answer-edits/codec";
import { TEST_SEEDED_DB_PATH } from "./env";
import { fillDatabase } from "./fill/fill";
import { openSqlite, type Sqlite } from "./fill/sqlite";

const SCALE = 0.02;
const SEED = 7;
const NOW = new Date("2026-11-02T15:00:00Z");

let scratch: string;
let seeded: Sqlite;
let filled: Sqlite;
let prisma: PrismaClient;
let counts: Record<string, number>;

/// A fresh copy of the seeded database, by name.
function copy(name: string): string {
	const file = path.join(scratch, name);
	copyFileSync(TEST_SEEDED_DB_PATH, file);
	return file;
}

function tablesOf(db: Sqlite): string[] {
	const rows = db
		.prepare(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
		)
		.all() as { name: string }[];
	return rows.map((row) => row.name);
}

test.beforeAll(async () => {
	scratch = mkdtempSync(path.join(tmpdir(), "codehood-fill-"));
	seeded = openSqlite(copy("seeded.db"));
	const file = copy("filled.db");
	counts = await fillDatabase({
		url: `file:${file}`,
		scale: SCALE,
		seed: SEED,
		now: NOW,
	});
	filled = openSqlite(file);
	prisma = new PrismaClient({
		adapter: new PrismaBetterSqlite3({ url: `file:${file}` }),
	});
});

test.afterAll(async () => {
	await prisma?.$disconnect();
	seeded?.close();
	filled?.close();
	rmSync(scratch, { recursive: true, force: true });
});

test("adds rows to every table that grows", () => {
	expect(counts.Course).toBeGreaterThanOrEqual(6);
	expect(counts.User).toBeGreaterThanOrEqual(100);
	expect(counts.Enrollment).toBeGreaterThan(100);
	expect(counts.Exam).toBe((counts.Course ?? 0) * 5);
	expect(counts.ResponseRef).toBeGreaterThan(300);
	expect(counts.Submission).toBeGreaterThan(3000);
	expect(counts.GradingJob).toBeGreaterThan(500);
	expect(counts.Feedback).toBeGreaterThan(1500);
	expect(counts.Attendance).toBeGreaterThan(500);

	// The models nothing in the application reads or writes.
	const unused = ["Group", "GroupMembership", "QuestionForCourse"];
	for (const table of tablesOf(filled)) {
		if (unused.includes(table)) continue;
		expect(counts[table] ?? 0, table).toBeGreaterThan(0);
	}
});

test("reports the rows it added", () => {
	for (const table of tablesOf(filled)) {
		const count = (db: Sqlite) =>
			(
				db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as {
					n: number;
				}
			).n;
		expect(count(filled) - count(seeded), table).toBe(counts[table] ?? 0);
	}
});

test("leaves a database that passes the integrity checks", () => {
	expect(filled.pragma("foreign_key_check")).toEqual([]);
	expect(filled.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
});

test("leaves every seeded row as it was", () => {
	for (const table of tablesOf(seeded)) {
		const before = seeded
			.prepare(`SELECT rowid AS _rowid, * FROM "${table}" ORDER BY rowid`)
			.all() as { _rowid: number }[];
		const last = before.at(-1)?._rowid ?? 0;
		const after = filled
			.prepare(
				`SELECT rowid AS _rowid, * FROM "${table}" WHERE rowid <= ? ORDER BY rowid`,
			)
			.all(last);
		expect(after, table).toEqual(before);
	}
});

test("keeps its rows apart from the seeded users and courses", async () => {
	const bulkUsers = await prisma.user.count({
		where: { username: { startsWith: "bulk-" } },
	});
	expect(bulkUsers).toBe(counts.User);
	const bulkCourses = await prisma.course.findMany({
		where: { disciplineSlug: { startsWith: "bulk-" } },
		select: { id: true, instructorId: true, editionSlug: true },
	});
	expect(bulkCourses).toHaveLength(counts.Course ?? 0);
	for (const course of bulkCourses) {
		expect(course.instructorId).toMatch(/^bulk-/);
		expect(course.editionSlug).toMatch(/^19\d\d-[12]$/);
	}

	const bulk = { in: bulkCourses.map((course) => course.id) };
	const outside = { course: { id: { notIn: bulk.in } } };
	const mixed = await Promise.all([
		prisma.enrollment.count({
			where: { courseId: bulk, NOT: { username: { startsWith: "bulk-" } } },
		}),
		prisma.enrollment.count({
			where: { ...outside, username: { startsWith: "bulk-" } },
		}),
		prisma.response.count({
			where: { exam: outside, authorId: { startsWith: "bulk-" } },
		}),
		prisma.gradingJob.count({
			where: {
				submission: { response: { exam: { courseId: bulk } } },
				NOT: { worker: { startsWith: "bulk-" } },
			},
		}),
	]);
	expect(mixed).toEqual([0, 0, 0, 0]);
});

test("gives the same rows for the same seed", async () => {
	const file = copy("again.db");
	const again = await fillDatabase({
		url: `file:${file}`,
		scale: SCALE,
		seed: SEED,
		now: NOW,
	});
	expect(again).toEqual(counts);

	const db = openSqlite(file);
	try {
		for (const table of ["Submission", "QuestionData", "Feedback", "User"]) {
			const sql = `SELECT * FROM "${table}" ORDER BY rowid DESC LIMIT 50`;
			expect(db.prepare(sql).all(), table).toEqual(filled.prepare(sql).all());
		}
	} finally {
		db.close();
	}

	const other = await fillDatabase({
		url: `file:${copy("other.db")}`,
		scale: SCALE,
		seed: SEED + 1,
		now: NOW,
	});
	expect(other).not.toEqual(counts);
});

test("refuses a database that already holds bulk data", async () => {
	const url = `file:${copy("twice.db")}`;
	const first = await fillDatabase({ url, scale: SCALE, seed: SEED, now: NOW });
	await expect(
		fillDatabase({ url, scale: SCALE, seed: SEED, now: NOW }),
	).rejects.toThrow(/already holds bulk data/);

	const db = openSqlite(url.slice("file:".length));
	try {
		const users = db
			.prepare(`SELECT COUNT(*) AS n FROM "User" WHERE username LIKE 'bulk-%'`)
			.get() as { n: number };
		expect(users.n).toBe(first.User);
	} finally {
		db.close();
	}
});

test("writes questions the application accepts", async () => {
	const versions = await prisma.questionData.findMany({
		where: { ref: { course: { disciplineSlug: { startsWith: "bulk-" } } } },
		include: { ref: { select: { type: true, latestId: true } } },
	});
	const types = new Set(versions.map((version) => version.ref.type));
	expect(types.size).toBe(9);
	for (const version of versions) {
		expect(version.createdAt).toBeInstanceOf(Date);
		publicQuestionSchema.parse(version.publicPayload);
		const document = questionDocument.parse(version.privatePayload);
		// An ordering question shuffles its public pool.
		if (document.type !== "ordering")
			expect(publicForm(document)).toEqual(version.publicPayload);
	}
});

test("writes answers that fit their questions", async () => {
	const submissions = await prisma.submission.findMany({
		where: { response: { authorId: { startsWith: "bulk-" } } },
		take: 1500,
		orderBy: { id: "desc" },
		include: {
			question: { select: { latest: { select: { privatePayload: true } } } },
			gradingJob: true,
			feedbacks: true,
		},
	});
	expect(submissions.length).toBeGreaterThan(1000);
	const kinds = new Set<string>();
	const states = new Set<string>();
	let reports = 0;
	for (const submission of submissions) {
		kinds.add(submission.kind);
		const document = questionDocument.parse(
			submission.question.latest?.privatePayload,
		);
		expect(() => assertResponse(document, submission.payload)).not.toThrow();
		expect(typeof submission.automaticallyTriggered).toBe("boolean");
		if (submission.gradingJob) {
			states.add(submission.gradingJob.state);
			expect(submission.kind).not.toBe("AUTOSAVE");
		}
		if (submission.runnerReport) {
			reports++;
			expect(submission.runnerReport).toMatchObject({ status: "completed" });
		}
		for (const feedback of submission.feedbacks) {
			const score = Number(feedback.score);
			expect(score).toBeGreaterThanOrEqual(0);
			expect(score).toBeLessThanOrEqual(1);
		}
	}
	expect([...kinds].sort()).toEqual(["AUTOSAVE", "FINAL", "SUBMIT"]);
	expect(states.size).toBeGreaterThanOrEqual(4);
	expect(reports).toBeGreaterThan(0);

	const manual = await prisma.feedback.findMany({
		where: { graderId: { startsWith: "bulk-" } },
		include: { rubricItems: true },
	});
	expect(manual.some((feedback) => feedback.rubricItems.length > 0)).toBe(true);
	for (const feedback of manual) {
		if (feedback.blanks === null) continue;
		for (const grade of Object.values(feedback.blanks as object))
			expect(typeof grade.score).toBe("number");
	}
});

test("writes edit histories that replay to the stored text", async () => {
	const fields = await prisma.answerEditField.findMany({
		where: { history: { response: { publicId: { startsWith: "bk" } } } },
		take: 100,
		orderBy: { id: "desc" },
		include: { batches: { orderBy: { revision: "asc" } }, history: true },
	});
	expect(fields.length).toBeGreaterThan(20);
	for (const field of fields) {
		let text = field.batches[0]?.baseText ?? "";
		for (const batch of field.batches)
			text = replayEdits(text, {
				version: batch.version,
				timeOriginMs: batch.timeOriginMs,
				edits: batch.edits,
			});
		expect(text).toBe(field.text);
		expect(field.revision).toBe(field.batches.length);
		expect(field.history.editCount).toBeGreaterThanOrEqual(field.nextSeq);
	}
});

test("writes git objects that hash to their names", async () => {
	const { createHash } = await import("node:crypto");
	const objects = await prisma.gitObject.findMany({
		where: { repository: { token: { startsWith: "bulk" } } },
	});
	expect(objects.length).toBeGreaterThan(0);
	for (const object of objects) {
		const body = Buffer.from(object.content);
		const sha = createHash("sha1")
			.update(`${object.type.toLowerCase()} ${body.length}\0`)
			.update(body)
			.digest("hex");
		expect(sha).toBe(object.sha);
	}
});
