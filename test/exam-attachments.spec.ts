import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { z } from "zod";
import { FULL_ACCESS } from "@/auth/actor";
import * as constants from "@/core/constants";
import { InvalidData, NotFound } from "@/core/error";
import type { CourseId, questionSchema } from "@/core/schemas";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedUserFactory } from "@/fixtures/user.factory";

type Doc = z.infer<typeof questionSchema>["question"];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/// `minutes` from the real clock, negative for the past.
function fromNow(minutes: number): Date {
	return new Date(Date.now() + minutes * MINUTE);
}

/// Random suffix, so slugs and blob contents never collide with sibling spec
/// files that share the test database.
function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

function hashOf(bytes: Buffer): string {
	return createHash("sha256").update(bytes).digest("hex");
}

/// Fresh bytes with their sha256.
function blob(label = "data"): { bytes: Buffer; hash: string } {
	const bytes = Buffer.from(`${label},${tag("")}\n1,2\n`);
	return { bytes, hash: hashOf(bytes) };
}

async function ensureEdition(slug = "2026-1"): Promise<string> {
	if (!(await db.edition.findOne({ slug }, FULL_ACCESS))) {
		await db.edition.create(
			{
				slug,
				name: slug,
				startAt: new Date("2026-01-01"),
				endAt: new Date("2030-12-31"),
			},
			FULL_ACCESS,
		);
	}
	return slug;
}

async function makeCourse() {
	const instructor = await persistedUserFactory.create({ role: "INSTRUCTOR" });
	const discipline = tag("disc");
	await db.discipline.create(
		{ slug: discipline, name: discipline },
		FULL_ACCESS,
	);
	const course = await db.course.create(
		{
			discipline,
			instructor: instructor.username,
			edition: await ensureEdition(),
			startAt: new Date("2026-01-01"),
			endAt: new Date("2026-05-01"),
		},
		FULL_ACCESS,
	);
	return { course, instructor };
}

async function enroll(courseId: CourseId) {
	const student = await persistedUserFactory.create({ role: "STUDENT" });
	await db.enrollment.create(
		{ course: courseId, username: student.username },
		FULL_ACCESS,
	);
	return student;
}

/// A course with its instructor, an enrolled student and a stranger.
async function setup() {
	const base = await makeCourse();
	return {
		...base,
		student: await enroll(base.course.id),
		outsider: await persistedUserFactory.create({ role: "STUDENT" }),
		opts: { actor: base.instructor },
	};
}

type Ctx = Awaited<ReturnType<typeof setup>>;

type Entry =
	| { name: string; format: string; text: string }
	| { name: string; format: string; origin: string; label?: string };

const NOTES: Entry = { name: "notes.txt", format: "txt", text: "read me" };

/// A link attachment whose origin is its own name.
function link(name: string): Entry {
	return { name, format: name.split(".").pop() ?? "csv", origin: name };
}

/// What an exam write may carry besides its own fields.
type Files = {
	attachments?: Entry[];
	files?: Record<string, string>;
	blobs?: Record<string, Buffer>;
};

/// Files for `entries`: one fresh blob per link, in the three fields of a write.
function filesFor(...names: string[]) {
	const made = names.map((name) => ({ name, ...blob(name) }));
	return {
		made,
		write: {
			attachments: names.map(link),
			files: Object.fromEntries(made.map((m) => [m.name, m.hash])),
			blobs: Object.fromEntries(made.map((m) => [m.hash, m.bytes])),
		} satisfies Files,
	};
}

type ExamWrite = Files & {
	slug?: string;
	status?: "DRAFT" | "SCHEDULED" | "ONGOING" | "ARCHIVED";
	scheduledAt?: Date | null;
	questions?: { slug: string; version?: string | null }[];
};

/// A one-hour exam that opened ten minutes ago, unless `write` says otherwise.
function createExam(ctx: Ctx, write: ExamWrite = {}) {
	return db.exam.create(
		{
			course: ctx.course.id,
			slug: write.slug ?? "ex1",
			title: "Exam",
			type: "EXAM",
			status: write.status ?? "SCHEDULED",
			scheduledAt:
				write.scheduledAt === undefined ? fromNow(-10) : write.scheduledAt,
			duration: { minutes: 60 },
			...(write.questions ? { questions: write.questions } : {}),
			...(write.attachments ? { attachments: write.attachments } : {}),
			...(write.files ? { files: write.files } : {}),
			...(write.blobs ? { blobs: write.blobs } : {}),
		},
		ctx.opts,
	);
}

function updateExam(
	ctx: Ctx,
	patch: Files & {
		scheduledAt?: Date | null;
		status?: "DRAFT" | "SCHEDULED" | "ONGOING" | "ARCHIVED";
	},
	slug = "ex1",
) {
	return db.exam.update({ course: ctx.course.id, slug }, patch, ctx.opts);
}

function pk(ctx: Ctx, slug = "ex1") {
	return { course: ctx.course.id, slug };
}

function view(ctx: Ctx, actor: { username: string } | Ctx["instructor"]) {
	return db.exam.findOne(pk(ctx), { actor: actor as Ctx["instructor"] });
}

async function examId(ctx: Ctx, slug = "ex1") {
	return (
		await prisma.exam.findFirstOrThrow({
			where: { courseId: ctx.course.id, slug },
		})
	).id;
}

async function examRows(id: number) {
	return prisma.attachment.findMany({
		where: { attachedToType: "EXAM", attachedToId: id },
		orderBy: { id: "asc" },
	});
}

function blobRow(hash: string) {
	return prisma.blob.findUnique({ where: { hash } });
}

async function refusal(attempt: Promise<unknown>): Promise<unknown> {
	return attempt.then(
		() => null,
		(e: unknown) => e,
	);
}

type Seen = { attachments?: Record<string, unknown>[]; files?: unknown };

function seen(value: unknown): Seen {
	return value as Seen;
}

function collectEverything() {
	return db.blob.collectGarbage({
		...FULL_ACCESS,
		olderThan: new Date(Date.now() + HOUR),
	});
}

function docWith(...attachments: Entry[]): Doc {
	return {
		type: "multiple-choice",
		title: "With files",
		stem: "Look at the attached files.",
		choices: [
			{ id: "a", text: "A", score: 1 },
			{ id: "b", text: "B" },
		],
		attachments,
	} as Doc;
}

/// Creates question `slug` in `ctx`'s course with a version per entry of `versions`.
async function createQuestion(
	ctx: Ctx,
	slug: string,
	versions: { version: string; entries: Entry[]; write: Files }[],
) {
	let first = true;
	for (const { version, entries, write } of versions) {
		const input = {
			version,
			question: docWith(...entries),
			...(write.files ? { files: write.files } : {}),
			...(write.blobs ? { blobs: write.blobs } : {}),
		};
		if (first) {
			await db.question.create(
				{ course: ctx.course.id, slug, status: "PUBLISHED", ...input },
				ctx.opts,
			);
			first = false;
		} else {
			await db.question.update(
				{ course: ctx.course.id, slug },
				input,
				ctx.opts,
			);
		}
	}
}

async function expectNothingStored(ctx: Ctx, hashes: string[], slug = "ex1") {
	expect(
		await prisma.exam.count({ where: { courseId: ctx.course.id, slug } }),
	).toBe(0);
	for (const hash of hashes) {
		expect(await blobRow(hash)).toBeNull();
		expect(await prisma.attachment.count({ where: { hash } })).toBe(0);
	}
}

// -----------------------------------------------------------------------------
// R10: writing

test("B5: create stores attachments with origin, files, the blob and one EXAM row", async () => {
	const ctx = await setup();
	const { made, write } = filesFor("a.csv");
	const attachments = [NOTES, ...write.attachments];

	const exam = await createExam(ctx, { ...write, attachments });

	const full = seen(await view(ctx, ctx.instructor));
	expect(full.attachments).toEqual(attachments);
	expect(full.files).toEqual({ "a.csv": made[0]?.hash });
	expect(seen(exam).files).toEqual({ "a.csv": made[0]?.hash });
	const rows = await examRows(await examId(ctx));
	expect(rows).toHaveLength(1);
	expect(rows[0]).toMatchObject({
		attachedToType: "EXAM",
		hash: made[0]?.hash,
		filename: "a.csv",
	});
});

test("B6: a link without a hash and files without attachments are refused; only fenced blocks are accepted alone", async () => {
	const ctx = await setup();
	const h = blob();

	expect(
		await refusal(
			createExam(ctx, { slug: "no-files", attachments: [link("a.csv")] }),
		),
	).toBeInstanceOf(InvalidData);
	expect(
		await refusal(
			createExam(ctx, {
				slug: "no-list",
				files: { "a.csv": h.hash },
				blobs: { [h.hash]: h.bytes },
			}),
		),
	).toBeInstanceOf(InvalidData);
	await expect(
		createExam(ctx, { slug: "fenced-only", attachments: [NOTES] }),
	).resolves.toBeTruthy();
	expect(await blobRow(h.hash)).toBeNull();
});

test("B6b: two attachments with the same name are InvalidData, storing nothing", async () => {
	const ctx = await setup();
	const h = blob();

	const error = await refusal(
		createExam(ctx, {
			attachments: [NOTES, { ...NOTES, text: "other" }],
		}),
	);
	const linked = await refusal(
		createExam(ctx, {
			slug: "dup-links",
			attachments: [link("a.csv"), link("a.csv")],
			files: { "a.csv": h.hash },
			blobs: { [h.hash]: h.bytes },
		}),
	);

	expect(error).toBeInstanceOf(InvalidData);
	expect(linked).toBeInstanceOf(InvalidData);
	expect(await blobRow(h.hash)).toBeNull();
});

test("B7: an update without attachments and files keeps the list, the map and the rows", async () => {
	const ctx = await setup();
	const { made, write } = filesFor("a.csv");
	await createExam(ctx, write);

	await updateExam(ctx, { scheduledAt: fromNow(-5) });

	const full = seen(await view(ctx, ctx.instructor));
	expect(full.attachments).toEqual(write.attachments);
	expect(full.files).toEqual({ "a.csv": made[0]?.hash });
	expect(await examRows(await examId(ctx))).toHaveLength(1);
});

test("B8: an update with the same list and no hash is refused, there is no inheritance on exams", async () => {
	const ctx = await setup();
	const { write } = filesFor("a.csv");
	await createExam(ctx, write);

	const error = await refusal(
		updateExam(ctx, { attachments: write.attachments }),
	);

	expect(error).toBeInstanceOf(InvalidData);
});

test("B9: a missing hash is 404, a wrong buffer, an extra buffer and an oversized fenced block are InvalidData, all storing nothing", async () => {
	const ctx = await setup();
	const ghost = blob("ghost");
	const claimed = blob("claimed");
	const actual = blob("actual");
	const cited = blob("cited");
	const extra = blob("extra");
	const list = { attachments: [link("a.csv")] };

	const missing = await refusal(
		createExam(ctx, {
			slug: "missing",
			...list,
			files: { "a.csv": ghost.hash },
		}),
	);
	expect(missing).toBeInstanceOf(NotFound);
	expect(missing).toMatchObject({ status: 404 });

	expect(
		await refusal(
			createExam(ctx, {
				slug: "wrong",
				...list,
				files: { "a.csv": claimed.hash },
				blobs: { [claimed.hash]: actual.bytes },
			}),
		),
	).toBeInstanceOf(InvalidData);

	expect(
		await refusal(
			createExam(ctx, {
				slug: "extra",
				...list,
				files: { "a.csv": cited.hash },
				blobs: { [cited.hash]: cited.bytes, [extra.hash]: extra.bytes },
			}),
		),
	).toBeInstanceOf(InvalidData);

	expect(
		await refusal(
			createExam(ctx, {
				slug: "big",
				attachments: [
					{
						name: "big.txt",
						format: "txt",
						text: "a".repeat(constants.MAX_FENCED_ATTACHMENT_BYTES + 1),
					},
				],
			}),
		),
	).toBeInstanceOf(InvalidData);

	for (const slug of ["missing", "wrong", "extra", "big"]) {
		await expectNothingStored(ctx, [], slug);
	}
	await expectNothingStored(
		ctx,
		[ghost.hash, claimed.hash, actual.hash, cited.hash, extra.hash],
		"missing",
	);
});

test("B10: replacing the files drops the rows that left, keeps the ones that stayed and the GC takes the dropped blob", async () => {
	const ctx = await setup();
	const { made, write } = filesFor("a.csv", "b.csv");
	const [a, b] = made as [(typeof made)[number], (typeof made)[number]];
	await createExam(ctx, write);
	const id = await examId(ctx);
	const bRow = (await examRows(id)).find((r) => r.filename === "b.csv");

	const c = blob("c.csv");
	await updateExam(ctx, {
		attachments: [link("b.csv"), link("c.csv")],
		files: { "b.csv": b.hash, "c.csv": c.hash },
		blobs: { [c.hash]: c.bytes },
	});

	const rows = await examRows(id);
	expect(rows.map((r) => [r.hash, r.filename]).sort()).toEqual(
		[
			[b.hash, "b.csv"],
			[c.hash, "c.csv"],
		].sort(),
	);
	expect(rows.find((r) => r.filename === "b.csv")?.id).toBe(bRow?.id);

	const collected = await collectEverything();
	expect(collected).toContain(a.hash);
	expect(collected).not.toContain(b.hash);
	expect(collected).not.toContain(c.hash);
});

test("B11: renaming a file swaps the row", async () => {
	const ctx = await setup();
	const { made, write } = filesFor("a.csv");
	const h = made[0]?.hash as string;
	await createExam(ctx, write);
	const id = await examId(ctx);

	await updateExam(ctx, {
		attachments: [link("x.csv")],
		files: { "x.csv": h },
	});

	const rows = await examRows(id);
	expect(rows.map((r) => [r.hash, r.filename])).toEqual([[h, "x.csv"]]);
});

// -----------------------------------------------------------------------------
// R13: reading

test("B12: a student gets an empty list before the exam opens, and the list without origin or hash while open and after it closed", async () => {
	const ctx = await setup();
	const { made, write } = filesFor("a.csv");
	const hash = made[0]?.hash as string;
	await createExam(ctx, {
		...write,
		attachments: [NOTES, ...write.attachments],
		scheduledAt: fromNow(60),
	});

	const before = await view(ctx, ctx.student);
	expect(seen(before).attachments).toEqual([]);
	expect(before).not.toHaveProperty("files");
	expect(JSON.stringify(before)).not.toContain(hash);

	for (const scheduledAt of [fromNow(-10), fromNow(-5 * 60)]) {
		await updateExam(ctx, { scheduledAt });
		const listed = [
			await view(ctx, ctx.student),
			(
				await db.exam.findMany(
					{ course: ctx.course.id },
					{ actor: ctx.student },
				)
			)[0],
		];
		for (const exam of listed) {
			expect(exam).not.toHaveProperty("files");
			expect(JSON.stringify(exam)).not.toContain(hash);
			const attachments = seen(exam).attachments ?? [];
			expect(attachments.map((a) => a.name)).toEqual(["notes.txt", "a.csv"]);
			for (const attachment of attachments) {
				expect(attachment).not.toHaveProperty("origin");
			}
			expect(attachments.find((a) => a.name === "notes.txt")?.text).toBe(
				"read me",
			);
		}
	}
});

test("B13: an exception that postpones the exam keeps the list empty for that student, a classmate sees it", async () => {
	const ctx = await setup();
	const classmate = await enroll(ctx.course.id);
	const { write } = filesFor("a.csv");
	await createExam(ctx, write);
	await db.examException.create(
		{
			course: ctx.course.id,
			exam: "ex1",
			username: ctx.student.username,
			extraTime: { minutes: 0 },
			scheduledAt: fromNow(24 * 60),
		},
		FULL_ACCESS,
	);

	expect(seen(await view(ctx, ctx.student)).attachments).toEqual([]);
	expect(seen(await view(ctx, classmate)).attachments).toHaveLength(1);
});

// -----------------------------------------------------------------------------
// R14: download

test("B14: the student downloads only while the window is open or past; the instructor always; the others never", async () => {
	const ctx = await setup();
	const { made, write } = filesFor("a.csv");
	const [a] = made as [(typeof made)[number]];
	await createExam(ctx, {
		...write,
		attachments: [NOTES, ...write.attachments],
		scheduledAt: fromNow(60),
	});
	const get = (actor: Ctx["instructor"], name = "a.csv") =>
		db.exam.attachment(pk(ctx), name, { actor });

	await expect(get(ctx.student)).rejects.toMatchObject({ status: 404 });
	const early = await get(ctx.instructor);
	expect(Buffer.from(early.bytes)).toEqual(a.bytes);

	await updateExam(ctx, { scheduledAt: fromNow(-10) });
	const open = await get(ctx.student);
	expect(Buffer.from(open.bytes)).toEqual(a.bytes);
	expect(open).toMatchObject({ mimeType: "text/csv", filename: "a.csv" });
	const notes = await get(ctx.student, "notes.txt");
	expect(Buffer.from(notes.bytes)).toEqual(Buffer.from("read me", "utf-8"));
	expect(notes.mimeType).toBe("text/plain; charset=utf-8");

	await updateExam(ctx, { scheduledAt: fromNow(-5 * 60) });
	expect(Buffer.from((await get(ctx.student)).bytes)).toEqual(a.bytes);

	await expect(get(ctx.outsider)).rejects.toMatchObject({ status: 404 });
	await expect(get(ctx.student, "nope.csv")).rejects.toMatchObject({
		status: 404,
	});
	await expect(get(ctx.instructor, "nope.csv")).rejects.toMatchObject({
		status: 404,
	});

	await updateExam(ctx, { status: "ARCHIVED" });
	await expect(get(ctx.student)).rejects.toMatchObject({ status: 404 });
});

test("B15: replacing a file on an open exam makes the old name 404 and the new one downloadable", async () => {
	const ctx = await setup();
	const { write } = filesFor("a.csv");
	await createExam(ctx, write);
	const c = blob("c.csv");

	await updateExam(ctx, {
		attachments: [link("c.csv")],
		files: { "c.csv": c.hash },
		blobs: { [c.hash]: c.bytes },
	});

	const opts = { actor: ctx.student };
	await expect(
		db.exam.attachment(pk(ctx), "a.csv", opts),
	).rejects.toMatchObject({ status: 404 });
	const served = await db.exam.attachment(pk(ctx), "c.csv", opts);
	expect(Buffer.from(served.bytes)).toEqual(c.bytes);
});

test("B16: a question attachment is served from the version the exam pins, behind the window", async () => {
	const ctx = await setup();
	const h1 = filesFor("data.csv");
	const h2 = filesFor("data.csv", "new.csv");
	await createQuestion(ctx, "q", [
		{ version: "v1", entries: h1.write.attachments, write: h1.write },
		{ version: "v2", entries: h2.write.attachments, write: h2.write },
	]);
	await createQuestion(ctx, "outside", [
		{
			version: "v1",
			entries: h1.write.attachments,
			write: { files: h1.write.files },
		},
	]);
	const v1 = h1.made[0]?.bytes as Buffer;
	const v2 = h2.made[0]?.bytes as Buffer;
	const newCsv = h2.made[1]?.bytes as Buffer;

	await createExam(ctx, {
		slug: "pinned",
		questions: [{ slug: "q", version: "v1" }],
	});
	await createExam(ctx, {
		slug: "latest",
		questions: [{ slug: "q", version: null }],
	});
	await createExam(ctx, {
		slug: "future",
		scheduledAt: fromNow(60),
		questions: [{ slug: "q", version: null }],
	});
	const get = (
		exam: string,
		question: string,
		name: string,
		actor = ctx.student,
	) => db.exam.questionAttachment(pk(ctx, exam), question, name, { actor });

	expect(Buffer.from((await get("pinned", "q", "data.csv")).bytes)).toEqual(v1);
	await expect(get("pinned", "q", "new.csv")).rejects.toMatchObject({
		status: 404,
	});
	expect(Buffer.from((await get("latest", "q", "data.csv")).bytes)).toEqual(v2);
	expect(Buffer.from((await get("latest", "q", "new.csv")).bytes)).toEqual(
		newCsv,
	);
	await expect(get("latest", "outside", "data.csv")).rejects.toMatchObject({
		status: 404,
	});
	await expect(get("future", "q", "data.csv")).rejects.toMatchObject({
		status: 404,
	});
	await expect(
		get("latest", "q", "data.csv", ctx.outsider),
	).rejects.toMatchObject({ status: 404 });
});

test("B16: names with a literal percent, unicode and case come back with the exact filename", async () => {
	const ctx = await setup();
	const names = ["a%20b.csv", "dados-ção.csv", "Data.csv", "data.csv"];
	const files = filesFor(...names);
	await createQuestion(ctx, "q", [
		{ version: "v1", entries: files.write.attachments, write: files.write },
	]);
	await createExam(ctx, { questions: [{ slug: "q", version: null }] });

	for (const { name, bytes } of files.made) {
		const served = await db.exam.questionAttachment(pk(ctx), "q", name, {
			actor: ctx.student,
		});
		expect(Buffer.from(served.bytes)).toEqual(bytes);
		expect(served.filename).toBe(name);
	}
});

// -----------------------------------------------------------------------------
// R11: deletion

test("B18: archiving an exam keeps its rows and the instructor still downloads", async () => {
	const ctx = await setup();
	const { made, write } = filesFor("a.csv");
	await createExam(ctx, write);
	const id = await examId(ctx);

	await db.exam.delete(pk(ctx), ctx.opts);

	expect(await examRows(id)).toHaveLength(1);
	const served = await db.exam.attachment(pk(ctx), "a.csv", ctx.opts);
	expect(Buffer.from(served.bytes)).toEqual(made[0]?.bytes);
});
