import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { type Actor, FULL_ACCESS } from "@/auth/actor";
import { BLOB_QUOTA_BY_ROLE } from "@/core/constants";
import { InvalidData, NotAllowed, NotFound } from "@/core/error";
import { isoDate } from "@/core/schemas/base";
import { MAX_UPLOAD_BYTES } from "@/core/schemas/blob";
import { db, type QuestionCreate, type User } from "@/db";
import { prisma } from "@/db/client";
import { makeAttachmentService } from "@/db/services/attachment.service";
import { makeBlobService } from "@/db/services/blob.service";
import { makeResponseService } from "@/db/services/response.service";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedResponseFactory } from "@/fixtures/response.factory";
import { persistedUserFactory } from "@/fixtures/user.factory";
import { uploadFactory } from "@/mdq/factory";
import { essay } from "@/mdq/fixtures";

function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

function hashOf(bytes: Buffer): string {
	return createHash("sha256").update(bytes).digest("hex");
}

/// Fresh bytes of `size` bytes, so no test shares a blob with another.
function fresh(size: number): Buffer {
	const seed = Buffer.from(tag("b"));
	return Buffer.concat([
		seed,
		Buffer.alloc(Math.max(0, size - seed.length), 7),
	]).subarray(0, size);
}

async function ensureEdition(slug = "2094-1"): Promise<string> {
	if (!(await db.edition.findOne({ slug }, FULL_ACCESS))) {
		await db.edition.create(
			{
				slug,
				name: slug,
				startDate: isoDate.parse("2026-01-01"),
				endDate: isoDate.parse("2030-12-31"),
			},
			FULL_ACCESS,
		);
	}
	return slug;
}

function studentQuota(): number {
	const quota = BLOB_QUOTA_BY_ROLE.STUDENT;
	if (quota === null) {
		throw new Error("test assumes STUDENT has a finite quota");
	}
	return quota;
}

/// An open attempt on an exam with upload questions `u` and `u2` (2 files, 1 KB, pdf and png) and the essay `v`.
async function makeWorld(options: { maxFiles?: number } = {}) {
	const instructor = await persistedUserFactory.create({ role: "INSTRUCTOR" });
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
		edition: await ensureEdition(),
	});
	const student = await persistedUserFactory.create({ role: "STUDENT" });
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	const config = {
		maxFiles: options.maxFiles ?? 2,
		maxSize: "1 KB",
		extensions: [".pdf", ".png"],
	};
	const make = (slug: string, doc: QuestionDoc) =>
		db.question.create(
			{
				course: course.id,
				slug,
				status: "PUBLISHED",
				version: "1",
				question: doc,
			},
			FULL_ACCESS,
		);
	const u = await make(tag("u-"), uploadFactory.build(config));
	const u2 = await make(tag("u2-"), uploadFactory.build(config));
	const big = await make(
		tag("big-"),
		uploadFactory.build({
			maxFiles: 1,
			maxSize: "20 MB",
			extensions: [".pdf"],
		}),
	);
	const v = await make(
		tag("v-"),
		essay({ id: "essay-v", title: "v", stem: "v" } as never),
	);
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: tag("exam-"),
		status: "ONGOING",
		type: "EXAM",
		questions: [u, u2, big, v].map((q) => ({ slug: q.slug })),
	});
	const attempt = await persistedResponseFactory.create({
		course: course.id,
		exam: exam.slug,
		author: student.username,
	});
	return { instructor, course, student, u, u2, big, v, exam, attempt };
}

type QuestionDoc = QuestionCreate["question"];

type World = Awaited<ReturnType<typeof makeWorld>>;

function put(
	w: World,
	question: { slug: string },
	filename: string,
	bytes: Buffer,
	actor: Actor | User = w.student,
	extra: { author?: string } = {},
	service: typeof db.response = db.response,
) {
	return service.uploadFile(
		{
			course: w.course.id,
			exam: w.exam.slug,
			question: question.slug,
			filename,
			bytes,
			...extra,
		},
		{ actor: actor as never },
	);
}

function remove(
	w: World,
	question: { slug: string },
	filename: string,
	actor: Actor | User = w.student,
	extra: { author?: string } = {},
) {
	return db.response.removeFile(
		{
			course: w.course.id,
			exam: w.exam.slug,
			question: question.slug,
			filename,
			...extra,
		},
		{ actor: actor as never },
	);
}

function rowsOf(w: World) {
	return prisma.attachment.findMany({
		where: { attachedToType: "RESPONSE", attachedToId: w.attempt.id },
		orderBy: { id: "asc" },
	});
}

function submissionCount(w: World) {
	return prisma.submission.count({ where: { responseId: w.attempt.id } });
}

async function newestPayload(w: World, question: { slug: string }) {
	const row = await prisma.submission.findFirst({
		where: { responseId: w.attempt.id, question: { slug: question.slug } },
		orderBy: { id: "desc" },
	});
	return row?.payload as Array<{
		name: string;
		path: string;
		size: number;
	}> | null;
}

/// A student-owned filler that brings the quota usage to `quota - room`.
async function fillQuota(student: User, room: number) {
	const hash = hashOf(Buffer.from(tag("filler")));
	await prisma.blob.create({ data: { hash, size: studentQuota() - room } });
	await prisma.attachment.create({
		data: {
			hash,
			filename: "filler.bin",
			mimeType: "application/octet-stream",
			uploaderId: student.username,
			attachedToType: "RESOURCE",
			attachedToId: 2_000_000_000 + Math.floor(Math.random() * 1_000_000),
		},
	});
}

async function expectNothingStored(
	w: World,
	bytes: Buffer,
	run: () => Promise<unknown>,
	error: new (...args: never[]) => Error,
) {
	const hash = hashOf(bytes);
	const rows = (await rowsOf(w)).length;
	const submissions = await submissionCount(w);
	await expect(run()).rejects.toBeInstanceOf(error);
	expect(await prisma.blob.findUnique({ where: { hash } })).toBeNull();
	expect(existsSync(db.blob.blobPath(hash))).toBe(false);
	expect((await rowsOf(w)).length).toBe(rows);
	expect(await submissionCount(w)).toBe(submissions);
}

//
// R15: refusals happen before any byte is written
//

test("R15: an upload to a closed attempt is refused and stores nothing", async () => {
	const w = await makeWorld();
	await prisma.response.update({
		where: { id: w.attempt.id },
		data: { acceptingSubmissions: false },
	});
	const bytes = fresh(10);
	await expectNothingStored(
		w,
		bytes,
		() => put(w, w.u, "a.pdf", bytes),
		InvalidData,
	);
});

test("R15: an upload by another student is refused with NotAllowed and stores nothing", async () => {
	const w = await makeWorld();
	const other = await persistedUserFactory.create({ role: "STUDENT" });
	await db.enrollment.create(
		{ course: w.course.id, username: other.username },
		FULL_ACCESS,
	);
	const bytes = fresh(10);
	await expectNothingStored(
		w,
		bytes,
		() => put(w, w.u, "a.pdf", bytes, other, { author: w.student.username }),
		NotAllowed,
	);
});

test("R15: an upload to a question that is not an upload question is refused and stores nothing", async () => {
	const w = await makeWorld();
	const bytes = fresh(10);
	await expectNothingStored(
		w,
		bytes,
		() => put(w, w.v, "a.pdf", bytes),
		InvalidData,
	);
});

test("R15: an empty file is refused and stores nothing", async () => {
	const w = await makeWorld();
	await expectNothingStored(
		w,
		Buffer.alloc(0),
		() => put(w, w.u, "a.pdf", Buffer.alloc(0)),
		InvalidData,
	);
});

test("R15: a file one byte over maxSize is refused, and exactly maxSize is accepted", async () => {
	const w = await makeWorld();
	const over = fresh(1025);
	await expectNothingStored(
		w,
		over,
		() => put(w, w.u, "a.pdf", over),
		InvalidData,
	);
	const exact = fresh(1024);
	const result = await put(w, w.u, "b.pdf", exact);
	expect(result.files?.map((f) => f.size)).toEqual([1024]);
});

test("R15: a file over the server ceiling is refused although the question allows 20 MB", async () => {
	const w = await makeWorld();
	const bytes = fresh(MAX_UPLOAD_BYTES + 1);
	await expectNothingStored(
		w,
		bytes,
		() => put(w, w.big, "a.pdf", bytes),
		InvalidData,
	);
});

test("R15: an extension the question does not list is refused and stores nothing", async () => {
	const w = await makeWorld();
	const bytes = fresh(10);
	await expectNothingStored(
		w,
		bytes,
		() => put(w, w.u, "a.exe", bytes),
		InvalidData,
	);
});

test("R15: a third file is refused when maxFiles is 2, and stores nothing", async () => {
	const w = await makeWorld();
	await put(w, w.u, "a.pdf", fresh(10));
	await put(w, w.u, "b.pdf", fresh(10));
	const bytes = fresh(10);
	await expectNothingStored(
		w,
		bytes,
		() => put(w, w.u, "c.pdf", bytes),
		InvalidData,
	);
});

test("R15: an upload that exceeds the uploader's quota is refused and stores nothing", async () => {
	const w = await makeWorld();
	await fillQuota(w.student, 5);
	const bytes = fresh(10);
	await expectNothingStored(
		w,
		bytes,
		() => put(w, w.u, "a.pdf", bytes),
		NotAllowed,
	);
});

//
// R15: replacement by name
//

test("R15: replacing a file by name near the quota is accepted, leaves one item with the new hash and drops the old row without tombstoning its blob", async () => {
	const w = await makeWorld();
	await fillQuota(w.student, 10);
	const first = fresh(10);
	const second = fresh(10);
	await put(w, w.u, "a.pdf", first);
	const result = await put(w, w.u, "a.pdf", second);

	expect(result.files).toEqual([
		{ name: "a.pdf", path: hashOf(second), size: 10 },
	]);
	const rows = await rowsOf(w);
	expect(rows.map((r) => r.hash)).toEqual([hashOf(second)]);
	const old = await prisma.blob.findUnique({ where: { hash: hashOf(first) } });
	expect(old?.deletedAt).toBeNull();
});

test("R15: names that differ only in case are one file after sanitizing", async () => {
	const w = await makeWorld();
	await put(w, w.u, "Relatório.PDF", fresh(10));
	const result = await put(w, w.u, "relatorio.pdf", fresh(10));
	expect(result.files?.map((f) => f.name)).toEqual(["relatorio.pdf"]);
	expect(await rowsOf(w)).toHaveLength(1);
});

test("R15: the same bytes under the same name twice keep one row and the usage, and write another autosave", async () => {
	const w = await makeWorld();
	const bytes = fresh(10);
	const first = await put(w, w.u, "a.pdf", bytes);
	const usage = await db.attachment.usageBytes(w.student.username, FULL_ACCESS);
	const submissions = await submissionCount(w);
	const second = await put(w, w.u, "a.pdf", bytes);

	expect(await rowsOf(w)).toHaveLength(1);
	expect(await db.attachment.usageBytes(w.student.username, FULL_ACCESS)).toBe(
		usage,
	);
	expect(await submissionCount(w)).toBe(submissions + 1);
	expect(second.submission).not.toBe(first.submission);
	const stored = await prisma.submission.findUnique({
		where: { publicId: second.submission },
	});
	expect(stored?.kind).toBe("AUTOSAVE");
});

//
// R15: concurrency
//

test("R15: two concurrent uploads that both fit end up in the newest submission and in two rows", async () => {
	const w = await makeWorld();
	await Promise.all([
		put(w, w.u, "a.pdf", fresh(10)),
		put(w, w.u, "b.png", fresh(10)),
	]);
	const names = (await newestPayload(w, w.u))?.map((f) => f.name).sort();
	expect(names).toEqual(["a.pdf", "b.png"]);
	expect(await rowsOf(w)).toHaveLength(2);
});

test("R15: two concurrent uploads under maxFiles 1 succeed once and are refused once, leaving one row", async () => {
	const w = await makeWorld({ maxFiles: 1 });
	const settled = await Promise.allSettled([
		put(w, w.u, "a.pdf", fresh(10)),
		put(w, w.u, "b.png", fresh(10)),
	]);
	expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
	const refused = settled.filter((s) => s.status === "rejected");
	expect(refused).toHaveLength(1);
	expect((refused[0] as PromiseRejectedResult).reason).toBeInstanceOf(
		InvalidData,
	);
	expect(await rowsOf(w)).toHaveLength(1);
});

//
// R15: the garbage collector marking the blob between storeBytes and attach
//

function responseWithGcRace(times: "once" | "always") {
	const blob = makeBlobService();
	let calls = 0;
	const racing = {
		...blob,
		storeBytes: async (bytes: Buffer, opts: never) => {
			const stored = await blob.storeBytes(bytes, opts);
			calls += 1;
			if (times === "always" || calls === 1) {
				await prisma.blob.update({
					where: { hash: hashOf(bytes) },
					data: { deletedAt: new Date() },
				});
			}
			return stored;
		},
	};
	return {
		service: makeResponseService(
			prisma,
			makeAttachmentService(racing as never, prisma),
			racing as never,
		),
		calls: () => calls,
	};
}

test("R15: a blob tombstoned between storeBytes and attach is stored again and the upload succeeds after one retry", async () => {
	const w = await makeWorld();
	const { service, calls } = responseWithGcRace("once");
	const bytes = fresh(10);
	const result = await put(
		w,
		w.u,
		"a.pdf",
		bytes,
		w.student,
		{},
		service as never,
	);
	expect(result.files).toEqual([
		{ name: "a.pdf", path: hashOf(bytes), size: 10 },
	]);
	expect(calls()).toBe(2);
	const row = await prisma.blob.findUnique({ where: { hash: hashOf(bytes) } });
	expect(row?.deletedAt).toBeNull();
});

test("R15: a blob tombstoned on every attempt gives NotFound and writes no submission", async () => {
	const w = await makeWorld();
	const { service } = responseWithGcRace("always");
	const before = await submissionCount(w);
	await expect(
		put(w, w.u, "a.pdf", fresh(10), w.student, {}, service as never),
	).rejects.toBeInstanceOf(NotFound);
	expect(await submissionCount(w)).toBe(before);
});

//
// R16: removal
//

test("R16: removing one of two files leaves the other and detaches the removed row", async () => {
	const w = await makeWorld();
	const a = fresh(10);
	const b = fresh(10);
	await put(w, w.u, "a.pdf", a);
	await put(w, w.u, "b.pdf", b);
	const result = await remove(w, w.u, "a.pdf");
	expect(result.files?.map((f) => f.name)).toEqual(["b.pdf"]);
	expect((await rowsOf(w)).map((r) => r.hash)).toEqual([hashOf(b)]);
});

test("R16: removing the last file writes a null answer", async () => {
	const w = await makeWorld();
	await put(w, w.u, "a.pdf", fresh(10));
	const result = await remove(w, w.u, "a.pdf");
	expect(result.files).toBeNull();
	expect(await newestPayload(w, w.u)).toBeNull();
	expect(await rowsOf(w)).toHaveLength(0);
});

test("R16: removing an unknown name is NotFound, and the name is compared exactly", async () => {
	const w = await makeWorld();
	await put(w, w.u, "Relatório.PDF", fresh(10));
	await expect(remove(w, w.u, "nope.pdf")).rejects.toBeInstanceOf(NotFound);
	await expect(remove(w, w.u, "Relatório.PDF")).rejects.toBeInstanceOf(
		NotFound,
	);
	expect(await rowsOf(w)).toHaveLength(1);
});

//
// R16: answer on an upload question
//

test("R16: answer accepts null and detaches the files no graded submission keeps", async () => {
	const w = await makeWorld();
	await put(w, w.u, "a.pdf", fresh(10));
	await db.response.answer(
		{
			course: w.course.id,
			exam: w.exam.slug,
			question: w.u.slug,
			payload: null,
		},
		{ actor: w.student },
	);
	expect(await rowsOf(w)).toHaveLength(0);
});

test("R16: answer accepts the current list unchanged and adds no attachment row", async () => {
	const w = await makeWorld();
	await put(w, w.u, "a.pdf", fresh(10));
	const { files } = await put(w, w.u, "b.pdf", fresh(10));
	const before = (await rowsOf(w)).length;
	await db.response.answer(
		{
			course: w.course.id,
			exam: w.exam.slug,
			question: w.u.slug,
			payload: files,
		},
		{ actor: w.student },
	);
	expect((await rowsOf(w)).length).toBe(before);
});

test("R16: answer refuses a reordered, shortened, altered or empty list with InvalidData", async () => {
	const w = await makeWorld();
	await put(w, w.u, "a.pdf", fresh(10));
	const { files } = await put(w, w.u, "b.pdf", fresh(10));
	const list = files as Array<{ name: string; path: string; size: number }>;
	const [first, second] = list as [(typeof list)[0], (typeof list)[0]];
	const variants = [
		[second, first],
		[first],
		[{ ...first, path: hashOf(Buffer.from("other")) }, second],
		[],
	];
	for (const payload of variants) {
		await expect(
			db.response.answer(
				{ course: w.course.id, exam: w.exam.slug, question: w.u.slug, payload },
				{ actor: w.student },
			),
		).rejects.toBeInstanceOf(InvalidData);
	}
	expect(await rowsOf(w)).toHaveLength(2);
});

//
// R17: what stays attached
//

async function gradedKeeps(kind: "feedback" | "regrade") {
	const w = await makeWorld();
	const h1 = fresh(10);
	const h2 = fresh(10);
	const first = await put(w, w.u, "a.pdf", h1);
	const s1 = await prisma.submission.findUniqueOrThrow({
		where: { publicId: first.submission },
	});
	if (kind === "feedback") {
		await prisma.feedback.create({
			data: { submissionId: s1.id, ref: "r1", score: "1", botId: "bot" },
		});
	} else {
		await prisma.regradeRequest.create({
			data: { publicId: tag("rr"), submissionId: s1.id, message: "please" },
		});
	}
	await put(w, w.u, "a.pdf", h2);
	expect((await rowsOf(w)).map((r) => r.hash).sort()).toEqual(
		[hashOf(h1), hashOf(h2)].sort(),
	);
	await db.response.answer(
		{
			course: w.course.id,
			exam: w.exam.slug,
			question: w.u.slug,
			payload: null,
		},
		{ actor: w.student },
	);
	expect((await rowsOf(w)).map((r) => r.hash)).toEqual([hashOf(h1)]);
}

test("R17: a null answer keeps the file a graded submission cites and detaches the current one", async () => {
	await gradedKeeps("feedback");
});

test("R17: a null answer keeps the file a submission with a regrade request cites", async () => {
	await gradedKeeps("regrade");
});

test("R17: the same name with different hashes on two upload questions are two rows, and removing from one keeps the other", async () => {
	const w = await makeWorld();
	const h1 = fresh(10);
	const h2 = fresh(10);
	await put(w, w.u, "relatorio.pdf", h1);
	await put(w, w.u2, "relatorio.pdf", h2);
	expect(await rowsOf(w)).toHaveLength(2);
	await remove(w, w.u, "relatorio.pdf");
	expect((await rowsOf(w)).map((r) => r.hash)).toEqual([hashOf(h2)]);
});

test("R17: the same name and hash on two upload questions share one row, kept while the other question cites it", async () => {
	const w = await makeWorld();
	const bytes = fresh(10);
	await put(w, w.u, "relatorio.pdf", bytes);
	await put(w, w.u2, "relatorio.pdf", bytes);
	expect(await rowsOf(w)).toHaveLength(1);
	await remove(w, w.u, "relatorio.pdf");
	expect((await rowsOf(w)).map((r) => r.hash)).toEqual([hashOf(bytes)]);
});

//
// Instructor on behalf of the student
//

test("R13a: an instructor's upload for a student is charged to the instructor and stays cited by the student's newest submission", async () => {
	const w = await makeWorld();
	const bytes = fresh(10);
	const before = await db.attachment.usageBytes(
		w.student.username,
		FULL_ACCESS,
	);
	const instructorBefore = await db.attachment.usageBytes(
		w.instructor.username,
		FULL_ACCESS,
	);
	await put(w, w.u, "a.pdf", bytes, w.instructor, {
		author: w.student.username,
	});

	const [row] = await rowsOf(w);
	expect(row?.uploaderId).toBe(w.instructor.username);
	expect(
		await db.attachment.usageBytes(w.instructor.username, FULL_ACCESS),
	).toBe(instructorBefore + 10);
	expect(await db.attachment.usageBytes(w.student.username, FULL_ACCESS)).toBe(
		before,
	);
	const newest = await prisma.submission.findFirst({
		where: { responseId: w.attempt.id },
		orderBy: { id: "desc" },
	});
	expect(newest?.createdById ?? null).toBeNull();
	expect(
		(newest?.payload as Array<{ path: string }> | undefined)?.[0]?.path,
	).toBe(hashOf(bytes));
});

//
// R19
//

test("R19: a SUBMIT on an upload question is InvalidData", async () => {
	const w = await makeWorld();
	await expect(
		db.response.answer(
			{
				course: w.course.id,
				exam: w.exam.slug,
				question: w.u.slug,
				payload: null,
				kind: "SUBMIT",
			},
			{ actor: w.student },
		),
	).rejects.toBeInstanceOf(InvalidData);
});

test("R19: an answer-edit item for an upload question is not accepted and creates no field", async () => {
	const w = await makeWorld();
	const result = await db.answerEdit.append(
		{
			course: w.course.id,
			exam: w.exam.slug,
			attempt: w.attempt.publicId,
			fields: [{ question: w.u.slug, field: "answer", batch: {} as never }],
		},
		{ actor: w.student },
	);
	expect(result.results.every((r) => r.kind !== "accepted")).toBe(true);
	expect(
		await prisma.answerEditField.count({
			where: { question: { slug: w.u.slug } },
		}),
	).toBe(0);
});

//
// R20
//

test("R20: another student's reads and refusals never carry the author's file hash", async () => {
	const w = await makeWorld();
	const other = await persistedUserFactory.create({ role: "STUDENT" });
	await db.enrollment.create(
		{ course: w.course.id, username: other.username },
		FULL_ACCESS,
	);
	const bytes = fresh(10);
	const hash = hashOf(bytes);
	await put(w, w.u, "a.pdf", bytes);

	const seen = (value: unknown) =>
		JSON.stringify(
			value instanceof Error ? { ...value, message: value.message } : value,
		);

	const list = await db.response
		.findMany({ course: w.course.id, exam: w.exam.slug }, { actor: other })
		.catch((e: unknown) => e);
	expect(seen(list)).not.toContain(hash);
	expect(seen(list)).not.toContain(w.attempt.publicId);

	const one = await db.response
		.findOne({ publicId: w.attempt.publicId }, { actor: other })
		.catch((e: unknown) => e);
	expect(seen(one)).not.toContain(hash);

	const refusedUpload = await put(w, w.u, "a.pdf", bytes, other, {
		author: w.student.username,
	}).catch((e: unknown) => e);
	expect(refusedUpload).toBeInstanceOf(Error);
	expect(seen(refusedUpload)).not.toContain(hash);

	const refusedRemoval = await remove(w, w.u, "a.pdf", other, {
		author: w.student.username,
	}).catch((e: unknown) => e);
	expect(refusedRemoval).toBeInstanceOf(Error);
	expect(seen(refusedRemoval)).not.toContain(hash);
});

test("G1: an upload leaves only the bytes file in the blob's directory, with no file named after the upload", async () => {
	const w = await makeWorld();
	const bytes = fresh(200);
	await put(w, w.u, "Notes.pdf", bytes);
	const dir = path.dirname(db.blob.blobPath(hashOf(bytes)));
	expect(readdirSync(dir)).toEqual([hashOf(bytes)]);
});

test("G7: two simultaneous first uploads of a student with no attempt either succeed or fail cleanly and retryably", async () => {
	const w = await makeWorld();
	const fresher = await persistedUserFactory.create({ role: "STUDENT" });
	await db.enrollment.create(
		{ course: w.course.id, username: fresher.username },
		FULL_ACCESS,
	);
	const results = await Promise.allSettled(
		["a.pdf", "b.pdf"].map((name) => put(w, w.u, name, fresh(100), fresher)),
	);
	expect(results.some((r) => r.status === "fulfilled")).toBe(true);
	for (const r of results) {
		if (r.status === "fulfilled") continue;
		const error = r.reason;
		const retryable =
			error instanceof InvalidData ||
			(error instanceof NotAllowed && error.status === 409);
		expect(retryable, String(error)).toBe(true);
	}
	const attempts = await prisma.response.count({
		where: { authorId: fresher.username, examId: w.exam.id },
	});
	expect(attempts).toBe(1);
});
