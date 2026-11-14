import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { z } from "zod";
import { FULL_ACCESS } from "@/auth/actor";
import * as constants from "@/core/constants";
import { InvalidData, NotFound } from "@/core/error";
import type { questionSchema } from "@/core/schemas";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedUserFactory } from "@/fixtures/user.factory";

type Doc = z.infer<typeof questionSchema>["question"];

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

/// A course with its instructor and one enrolled student.
async function setup() {
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
	const student = await persistedUserFactory.create({ role: "STUDENT" });
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	const outsider = await persistedUserFactory.create({ role: "STUDENT" });
	return {
		course,
		instructor,
		student,
		outsider,
		opts: { actor: instructor },
	};
}

type Entry =
	| { name: string; format: string; text: string }
	| { name: string; format: string; origin: string; label?: string };

const NOTES: Entry = { name: "notes.txt", format: "txt", text: "read me" };

/// A link attachment whose origin is its own name.
function link(name: string): Entry {
	return { name, format: name.split(".").pop() ?? "csv", origin: name };
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

type Ctx = Awaited<ReturnType<typeof setup>>;

/// Input of a question write, with the new fields the service now accepts.
type Write = {
	version?: string;
	files?: Record<string, string>;
	blobs?: Record<string, Buffer>;
	status?: "DRAFT" | "PUBLISHED";
	slug?: string;
};

function createInput(ctx: Ctx, doc: Doc, write: Write = {}) {
	return {
		course: ctx.course.id,
		slug: write.slug ?? "q1",
		status: write.status ?? "PUBLISHED",
		version: write.version ?? "v1",
		question: doc,
		...(write.files ? { files: write.files } : {}),
		...(write.blobs ? { blobs: write.blobs } : {}),
	};
}

function create(ctx: Ctx, doc: Doc, write: Write = {}) {
	return db.question.create(createInput(ctx, doc, write), ctx.opts);
}

function update(ctx: Ctx, doc: Doc, write: Write, slug = "q1") {
	const { files, blobs, version } = write;
	return db.question.update(
		{ course: ctx.course.id, slug },
		{
			version,
			question: doc,
			...(files ? { files } : {}),
			...(blobs ? { blobs } : {}),
		},
		ctx.opts,
	);
}

async function rowsOf(courseId: number) {
	const refs = await prisma.questionRef.findMany({
		where: { courseId },
		select: { id: true },
	});
	return prisma.attachment.findMany({
		where: {
			attachedToType: "QUESTION",
			attachedToId: { in: refs.map((r) => r.id) },
		},
		orderBy: { id: "asc" },
	});
}

function versionsOf(courseId: number, slug = "q1") {
	return prisma.questionData.findMany({
		where: { ref: { courseId, slug } },
		orderBy: { id: "asc" },
	});
}

function blobRow(hash: string) {
	return prisma.blob.findUnique({ where: { hash } });
}

async function publicIdOf(courseId: number, slug = "q1") {
	const ref = await prisma.questionRef.findFirstOrThrow({
		where: { courseId, slug },
	});
	return ref.publicId;
}

/// Asserts that a refused write left no question, version, blob or row behind.
async function expectNothingStored(ctx: Ctx, hashes: string[], slug = "q1") {
	expect(
		await prisma.questionRef.count({
			where: { courseId: ctx.course.id, slug },
		}),
	).toBe(0);
	for (const hash of hashes) {
		expect(await blobRow(hash)).toBeNull();
		expect(await prisma.attachment.count({ where: { hash } })).toBe(0);
	}
}

/// Creates `q1` with `data.csv` at v1 (H1) and v2 (H2); the latest is v2.
async function twoVersions() {
	const ctx = await setup();
	const h1 = blob("v1");
	const h2 = blob("v2");
	const doc = docWith(NOTES, link("data.csv"));
	await create(ctx, doc, {
		version: "v1",
		files: { "data.csv": h1.hash },
		blobs: { [h1.hash]: h1.bytes },
	});
	await update(ctx, doc, {
		version: "v2",
		files: { "data.csv": h2.hash },
		blobs: { [h2.hash]: h2.bytes },
	});
	return { ctx, h1, h2, doc };
}

async function refusal(attempt: Promise<unknown>): Promise<unknown> {
	return attempt.then(
		() => null,
		(e: unknown) => e,
	);
}

// -----------------------------------------------------------------------------
// R7, R9: storing bytes

test("A1: create stores files, the blob and one QUESTION attachment row", async () => {
	const ctx = await setup();
	const h1 = blob();

	const question = await create(ctx, docWith(NOTES, link("data.csv")), {
		files: { "data.csv": h1.hash },
		blobs: { [h1.hash]: h1.bytes },
	});

	const full = await db.question.findOne(
		{ course: ctx.course.id, slug: "q1", public: false },
		ctx.opts,
	);
	expect((full as { files?: unknown }).files).toEqual({
		"data.csv": h1.hash,
	});
	expect((question as { files?: unknown }).files).toEqual({
		"data.csv": h1.hash,
	});
	expect(await blobRow(h1.hash)).not.toBeNull();

	const ref = await prisma.questionRef.findFirstOrThrow({
		where: { courseId: ctx.course.id, slug: "q1" },
	});
	const rows = await prisma.attachment.findMany({ where: { hash: h1.hash } });
	expect(rows).toHaveLength(1);
	expect(rows[0]).toMatchObject({
		attachedToType: "QUESTION",
		attachedToId: ref.id,
		filename: "data.csv",
		hash: h1.hash,
	});
});

test("A2: a buffer under a key that is not its sha256 is refused and nothing is stored", async () => {
	const ctx = await setup();
	const claimed = blob("claimed");
	const actual = blob("actual");

	const error = await refusal(
		create(ctx, docWith(link("data.csv")), {
			files: { "data.csv": claimed.hash },
			blobs: { [claimed.hash]: actual.bytes },
		}),
	);

	expect(error).toBeInstanceOf(InvalidData);
	await expectNothingStored(ctx, [claimed.hash, actual.hash]);
});

test("A3: a buffer no files entry cites is refused and nothing is stored", async () => {
	const ctx = await setup();
	const cited = blob("cited");
	const extra = blob("extra");

	const error = await refusal(
		create(ctx, docWith(link("data.csv")), {
			files: { "data.csv": cited.hash },
			blobs: { [cited.hash]: cited.bytes, [extra.hash]: extra.bytes },
		}),
	);

	expect(error).toBeInstanceOf(InvalidData);
	await expectNothingStored(ctx, [cited.hash, extra.hash]);
});

// -----------------------------------------------------------------------------
// R8: rules of a write

test("A4: an update of an older label without files inherits that label's hashes", async () => {
	const { ctx, h1, doc } = await twoVersions();

	const question = await update(ctx, doc, { version: "v1" });

	expect(question.version).toBe("v1");
	const full = await db.question.findOne(
		{ course: ctx.course.id, slug: "q1", public: false, version: "v1" },
		ctx.opts,
	);
	expect((full as { files?: unknown }).files).toEqual({
		"data.csv": h1.hash,
	});
	expect(await versionsOf(ctx.course.id)).toHaveLength(2);
});

test("A5: a new label without files inherits the hashes of the latest", async () => {
	const { ctx, h2, doc } = await twoVersions();

	const question = await update(ctx, doc, { version: "v3" });

	expect(question.version).toBe("v3");
	const v3 = (await versionsOf(ctx.course.id)).find(
		(v) => v.versionHash === "v3",
	);
	expect((v3 as { files?: unknown } | undefined)?.files).toEqual({
		"data.csv": h2.hash,
	});
});

test("A6: inheritance is by name only, a new link name without files is refused", async () => {
	const { ctx } = await twoVersions();

	const error = await refusal(
		update(ctx, docWith(NOTES, link("other.csv")), { version: "v3" }),
	);

	expect(error).toBeInstanceOf(InvalidData);
	expect(await versionsOf(ctx.course.id)).toHaveLength(2);
});

test("A7: files naming something that is not a link attachment is refused", async () => {
	const ctx = await setup();
	const h = blob();

	for (const name of ["notes.txt", "whatever.bin"]) {
		const error = await refusal(
			create(ctx, docWith(NOTES, link("data.csv")), {
				files: { "data.csv": h.hash, [name]: h.hash },
				blobs: { [h.hash]: h.bytes },
			}),
		);
		expect(error).toBeInstanceOf(InvalidData);
	}
	await expectNothingStored(ctx, [h.hash]);
});

test("A8: a hash that is neither a live blob nor in blobs is NotFound, and nothing is stored", async () => {
	const ctx = await setup();
	const ghost = blob("ghost");

	const error = await refusal(
		create(ctx, docWith(link("data.csv")), {
			files: { "data.csv": ghost.hash },
		}),
	);

	expect(error).toBeInstanceOf(NotFound);
	expect(error).toMatchObject({ status: 404 });
	await expectNothingStored(ctx, [ghost.hash]);
});

test("A9: a hash that is already a live blob is accepted without blobs", async () => {
	const ctx = await setup();
	const h = blob();
	await create(ctx, docWith(link("data.csv")), {
		slug: "first",
		files: { "data.csv": h.hash },
		blobs: { [h.hash]: h.bytes },
	});

	const question = await create(ctx, docWith(link("data.csv")), {
		slug: "second",
		files: { "data.csv": h.hash },
	});

	expect(question.slug).toBe("second");
	expect(await prisma.attachment.count({ where: { hash: h.hash } })).toBe(2);
});

test("A10: fenced attachments may sum to the limit, one byte more is refused", async () => {
	const ctx = await setup();
	const half = constants.MAX_FENCED_ATTACHMENT_BYTES / 2;
	const fenced = (name: string, size: number): Entry => ({
		name,
		format: "txt",
		text: "a".repeat(size),
	});

	await expect(
		create(ctx, docWith(fenced("a.txt", half), fenced("b.txt", half)), {
			slug: "at-limit",
		}),
	).resolves.toBeTruthy();

	const error = await refusal(
		create(ctx, docWith(fenced("a.txt", half), fenced("b.txt", half + 1)), {
			slug: "over-limit",
		}),
	);
	expect(error).toBeInstanceOf(InvalidData);
	expect(
		await prisma.questionRef.count({
			where: { courseId: ctx.course.id, slug: "over-limit" },
		}),
	).toBe(0);
});

test("A10: the limit counts UTF-8 bytes, not characters", async () => {
	const ctx = await setup();
	// "ç" is two bytes: this has half the limit in characters, all of it plus
	// two bytes in UTF-8.
	const text = "ç".repeat(constants.MAX_FENCED_ATTACHMENT_BYTES / 2 + 1);

	const error = await refusal(
		create(ctx, docWith({ name: "wide.txt", format: "txt", text })),
	);

	expect(error).toBeInstanceOf(InvalidData);
});

// -----------------------------------------------------------------------------
// R9: version label and rows

test("A11: rewriting the same label and document with files {} is idempotent", async () => {
	const ctx = await setup();
	const doc = docWith(NOTES);
	await create(ctx, doc);

	const again = await db.question.upsert(
		createInput(ctx, doc, { files: {} }),
		ctx.opts,
	);

	expect(again.version).toBe("v1");
	expect(await versionsOf(ctx.course.id)).toHaveLength(1);
});

test("A12: the same label and document with different files is a 409 and leaves the version intact", async () => {
	const ctx = await setup();
	const h1 = blob("one");
	const h2 = blob("two");
	const doc = docWith(link("data.csv"));
	await create(ctx, doc, {
		files: { "data.csv": h1.hash },
		blobs: { [h1.hash]: h1.bytes },
	});

	const error = await refusal(
		update(ctx, doc, {
			version: "v1",
			files: { "data.csv": h2.hash },
			blobs: { [h2.hash]: h2.bytes },
		}),
	);

	expect(error).toMatchObject({
		status: 409,
	});
	const versions = await versionsOf(ctx.course.id);
	expect(versions).toHaveLength(1);
	expect((versions[0] as { files?: unknown }).files).toEqual({
		"data.csv": h1.hash,
	});
	expect(await blobRow(h2.hash)).toBeNull();
});

test("A13: rows are created for pairs the question does not have yet, never duplicated", async () => {
	const ctx = await setup();
	const h1 = blob("one");
	const h2 = blob("two");
	const doc = docWith(link("data.csv"));
	await create(ctx, doc, {
		version: "v1",
		files: { "data.csv": h1.hash },
		blobs: { [h1.hash]: h1.bytes },
	});
	expect(await rowsOf(ctx.course.id)).toHaveLength(1);

	// v2 with the same pair: no new row.
	await update(ctx, doc, { version: "v2", files: { "data.csv": h1.hash } });
	expect(await rowsOf(ctx.course.id)).toHaveLength(1);

	// v3 with a new hash: one more row, the one of H1 stays.
	const write = {
		version: "v3",
		files: { "data.csv": h2.hash },
		blobs: { [h2.hash]: h2.bytes },
	};
	await update(ctx, doc, write);
	const rows = await rowsOf(ctx.course.id);
	expect(rows.map((r) => r.hash).sort()).toEqual([h1.hash, h2.hash].sort());

	// Repeating the same write adds nothing.
	await update(ctx, doc, { version: "v3", files: { "data.csv": h2.hash } });
	expect(await rowsOf(ctx.course.id)).toHaveLength(2);
});

test("A14: a write that would exceed the author's quota is refused, with no version and no row", async () => {
	const ctx = await setup();
	const quota = constants.BLOB_QUOTA_BY_ROLE.INSTRUCTOR;
	if (quota === null) throw new Error("test assumes a finite instructor quota");

	// Usage near the quota with a fabricated blob, as attachment-service.spec.ts does.
	const filler = blob("filler");
	await prisma.blob.create({ data: { hash: filler.hash, size: quota - 10 } });
	await create(ctx, docWith(NOTES), { slug: "holder", status: "DRAFT" });
	const fillerRef = await prisma.questionRef.findFirstOrThrow({
		where: { courseId: ctx.course.id, slug: "holder" },
	});
	await prisma.attachment.create({
		data: {
			hash: filler.hash,
			filename: "filler.txt",
			mimeType: "text/plain",
			uploaderId: ctx.instructor.username,
			attachedToType: "QUESTION",
			attachedToId: fillerRef.id,
		},
	});

	const big = Buffer.from("x".repeat(20));
	const bigHash = hashOf(big);
	const error = await refusal(
		create(ctx, docWith(link("data.csv")), {
			files: { "data.csv": bigHash },
			blobs: { [bigHash]: big },
		}),
	);

	expect(error).not.toBeNull();
	expect(
		await prisma.questionRef.count({
			where: { courseId: ctx.course.id, slug: "q1" },
		}),
	).toBe(0);
	expect(await blobRow(bigHash)).toBeNull();
	expect(await prisma.attachment.count({ where: { hash: bigHash } })).toBe(0);
	expect(existsSync(db.blob.blobPath(bigHash))).toBe(false);
});

test("A14b: `files` or `blobs` without `question` and `version` are refused, not ignored", async () => {
	const ctx = await setup();
	await create(ctx, docWith(NOTES));
	const h = blob();

	const noQuestion = await refusal(
		db.question.update(
			{ course: ctx.course.id, slug: "q1" },
			{ files: { "data.csv": h.hash }, blobs: { [h.hash]: h.bytes } },
			ctx.opts,
		),
	);
	const noVersion = await refusal(
		db.question.update(
			{ course: ctx.course.id, slug: "q1" },
			{ blobs: { [h.hash]: h.bytes } },
			ctx.opts,
		),
	);

	expect(noQuestion).toBeInstanceOf(InvalidData);
	expect(noVersion).toBeInstanceOf(InvalidData);
	expect(await blobRow(h.hash)).toBeNull();
	expect(existsSync(db.blob.blobPath(h.hash))).toBe(false);
});

// -----------------------------------------------------------------------------
// R13: reading

test("A15: a student sees no files, no origin and no hash; the author with public: true neither", async () => {
	const ctx = await setup();
	const h1 = blob();
	await create(ctx, docWith(NOTES, link("data.csv")), {
		files: { "data.csv": h1.hash },
		blobs: { [h1.hash]: h1.bytes },
	});
	const pk = { course: ctx.course.id, slug: "q1" };

	const views = [
		await db.question.findOne({ ...pk, public: true }, { actor: ctx.student }),
		(await db.question.findMany(pk, { actor: ctx.student }))[0],
		await db.question.findOne({ ...pk, public: true }, ctx.opts),
	];
	for (const view of views) {
		if (!view) throw new Error("question not found");
		expect(view).not.toHaveProperty("files");
		expect(JSON.stringify(view)).not.toContain(h1.hash);
		const attachments = (
			view.question as unknown as { attachments?: Record<string, unknown>[] }
		).attachments;
		expect(attachments).toHaveLength(2);
		for (const attachment of attachments ?? []) {
			expect(attachment).not.toHaveProperty("origin");
		}
		expect(attachments?.find((a) => a.name === "notes.txt")?.text).toBe(
			"read me",
		);
	}

	const full = await db.question.findOne({ ...pk, public: false }, ctx.opts);
	expect((full as { files?: unknown }).files).toEqual({
		"data.csv": h1.hash,
	});
});

// -----------------------------------------------------------------------------
// R14: download

test("A16: the author downloads a link by its blob and a fenced block from the payload", async () => {
	const ctx = await setup();
	const h1 = blob();
	await create(ctx, docWith(NOTES, link("data.csv")), {
		files: { "data.csv": h1.hash },
		blobs: { [h1.hash]: h1.bytes },
	});
	const publicId = await publicIdOf(ctx.course.id);

	const csv = await db.question.attachment({ publicId }, "data.csv", ctx.opts);
	expect(Buffer.from(csv.bytes)).toEqual(h1.bytes);
	expect(csv.mimeType).toBe("text/csv");
	expect(csv.filename).toBe("data.csv");

	const notes = await db.question.attachment(
		{ publicId },
		"notes.txt",
		ctx.opts,
	);
	expect(Buffer.from(notes.bytes)).toEqual(Buffer.from("read me", "utf-8"));
	expect(notes.mimeType).toBe("text/plain; charset=utf-8");
	expect(notes.filename).toBe("notes.txt");
});

test("A17: a version label picks that version's bytes, no label picks the latest", async () => {
	const { ctx, h1, h2 } = await twoVersions();
	const publicId = await publicIdOf(ctx.course.id);

	const v1 = await db.question.attachment(
		{ publicId, version: "v1" },
		"data.csv",
		ctx.opts,
	);
	const latest = await db.question.attachment(
		{ publicId },
		"data.csv",
		ctx.opts,
	);

	expect(Buffer.from(v1.bytes)).toEqual(h1.bytes);
	expect(Buffer.from(latest.bytes)).toEqual(h2.bytes);
});

test("A18: a version the question never had is NotFound, not the latest", async () => {
	const { ctx } = await twoVersions();
	const publicId = await publicIdOf(ctx.course.id);

	await expect(
		db.question.attachment(
			{ publicId, version: "nao-existe" },
			"data.csv",
			ctx.opts,
		),
	).rejects.toMatchObject({ status: 404 });
});

test("A19: a student, an outsider and an unknown name all get the same 404", async () => {
	const ctx = await setup();
	const h1 = blob();
	await create(ctx, docWith(NOTES, link("data.csv")), {
		files: { "data.csv": h1.hash },
		blobs: { [h1.hash]: h1.bytes },
	});
	const publicId = await publicIdOf(ctx.course.id);

	const errors = [
		await refusal(
			db.question.attachment({ publicId }, "data.csv", {
				actor: ctx.student,
			}),
		),
		await refusal(
			db.question.attachment({ publicId }, "data.csv", {
				actor: ctx.outsider,
			}),
		),
		await refusal(db.question.attachment({ publicId }, "nope.csv", ctx.opts)),
	];

	for (const error of errors) {
		expect(error).toBeInstanceOf(NotFound);
		expect(error).toMatchObject({ status: 404 });
	}
	const [first, ...rest] = errors as NotFound[];
	for (const error of rest) {
		expect(error.message).toBe(first?.message);
	}
});

test("A20: each name is served under its exact filename, with percent signs, unicode and case kept", async () => {
	const ctx = await setup();
	const names = ["a%20b.csv", "dados-ção.csv", "Data.csv", "data.csv"];
	const blobs = names.map((name) => ({ name, ...blob(name) }));
	await create(ctx, docWith(...names.map(link)), {
		files: Object.fromEntries(blobs.map((b) => [b.name, b.hash])),
		blobs: Object.fromEntries(blobs.map((b) => [b.hash, b.bytes])),
	});
	const publicId = await publicIdOf(ctx.course.id);

	for (const { name, bytes } of blobs) {
		const served = await db.question.attachment({ publicId }, name, ctx.opts);
		expect(Buffer.from(served.bytes)).toEqual(bytes);
		expect(served.filename).toBe(name);
	}
	await expect(
		db.question.attachment({ publicId }, "a b.csv", ctx.opts),
	).rejects.toMatchObject({ status: 404 });
});

// -----------------------------------------------------------------------------
// R11: deletion

test("A21: archiving a question keeps its attachment rows and the author still downloads v1", async () => {
	const ctx = await setup();
	const h1 = blob();
	await create(ctx, docWith(link("data.csv")), {
		files: { "data.csv": h1.hash },
		blobs: { [h1.hash]: h1.bytes },
	});
	const publicId = await publicIdOf(ctx.course.id);

	await db.question.delete({ course: ctx.course.id, slug: "q1" }, ctx.opts);

	expect(await rowsOf(ctx.course.id)).toHaveLength(1);
	const served = await db.question.attachment(
		{ publicId, version: "v1" },
		"data.csv",
		ctx.opts,
	);
	expect(Buffer.from(served.bytes)).toEqual(h1.bytes);
});
