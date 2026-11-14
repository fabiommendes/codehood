import { createHash } from "node:crypto";
import type { z } from "zod";
import { FULL_ACCESS } from "@/auth/actor";
import type { questionSchema } from "@/core/schemas";
import { db, type User } from "@/db";
import { prisma } from "@/db/client";
import { type APIRequestContext, expect, test } from "./fixtures";
import { logInAs } from "./stories/helpers";

/// Attachments of questions and exams over HTTP: the multipart writes, the
/// three download routes and what a student can and cannot see.

type Doc = z.infer<typeof questionSchema>["question"];

const PASSWORD = "correct-horse-battery-staple";
const MINUTE = 60_000;

function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

function sha256(bytes: Buffer): string {
	return createHash("sha256").update(bytes).digest("hex");
}

/// Fresh bytes with their sha256.
function blob(label = "data"): { bytes: Buffer; hash: string } {
	const bytes = Buffer.from(`${label},${tag("")}\n1,2\n`);
	return { bytes, hash: sha256(bytes) };
}

function fromNow(minutes: number): Date {
	return new Date(Date.now() + minutes * MINUTE);
}

async function makeUser(role: "INSTRUCTOR" | "STUDENT"): Promise<User> {
	const username = tag(role.toLowerCase());
	return db.user.create(
		{
			email: `${username}@codehood.test`,
			username,
			name: username,
			role,
			password: PASSWORD,
			githubId: username,
			schoolId: username,
		},
		FULL_ACCESS,
	);
}

async function tokenFor(request: APIRequestContext, username: string) {
	const login = await request.post("/api/auth/login", {
		data: { login: username, password: PASSWORD },
	});
	expect(login.ok()).toBe(true);
	const { token } = await login.json();
	return { Authorization: `Bearer ${token}`, Cookie: "" };
}

/// No credentials at all, even if the shared request context holds a cookie.
const ANONYMOUS = { Cookie: "" };

type Entry =
	| { name: string; format: string; text: string }
	| { name: string; format: string; origin: string; label?: string };

/// A link attachment whose origin is its own name.
function link(name: string): Entry {
	return { name, format: name.split(".").pop() ?? "csv", origin: name };
}

/// A fenced attachment: the content travels inside the document.
function fenced(name: string, text: string): Entry {
	return { name, format: name.split(".").pop() ?? "txt", text };
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
		...(attachments.length > 0 && { attachments }),
	} as Doc;
}

/// A multipart request: the JSON body in `json`, one part per file by hash.
function multipart(body: unknown, ...files: Buffer[]) {
	return {
		json: JSON.stringify(body),
		...Object.fromEntries(
			files.map((bytes) => [
				sha256(bytes),
				{ name: "file", mimeType: "application/octet-stream", buffer: bytes },
			]),
		),
	};
}

/// A course with its instructor, an enrolled student and a stranger.
async function setup() {
	const instructor = await makeUser("INSTRUCTOR");
	const discipline = tag("disc");
	await db.discipline.create(
		{ slug: discipline, name: discipline },
		FULL_ACCESS,
	);
	if (!(await db.edition.findOne({ slug: "2026-1" }, FULL_ACCESS))) {
		await db.edition.create(
			{
				slug: "2026-1",
				name: "2026-1",
				startAt: new Date("2026-01-01"),
				endAt: new Date("2030-12-31"),
			},
			FULL_ACCESS,
		);
	}
	const course = await db.course.create(
		{
			discipline,
			instructor: instructor.username,
			edition: "2026-1",
			startAt: new Date("2026-01-01"),
			endAt: new Date("2030-05-01"),
		},
		FULL_ACCESS,
	);
	const student = await makeUser("STUDENT");
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	const base = `/api/course/${discipline}/${instructor.username}_2026-1`;
	return {
		instructor,
		student,
		course,
		discipline,
		courseSegment: `${instructor.username}_2026-1`,
		base,
		questionUrl: `${base}/question`,
		examUrl: `${base}/exam`,
		opts: { actor: instructor },
	};
}

type Ctx = Awaited<ReturnType<typeof setup>>;

async function publicIdOf(ctx: Ctx, slug: string) {
	const ref = await prisma.questionRef.findFirstOrThrow({
		where: { courseId: ctx.course.id, slug },
	});
	return ref.publicId;
}

function blobRow(hash: string) {
	return prisma.blob.findUnique({ where: { hash } });
}

/// Creates a published question with one version per entry, each with its blobs.
async function createQuestion(
	ctx: Ctx,
	slug: string,
	versions: { version: string; entries: Entry[]; blobs?: Buffer[] }[],
) {
	let first = true;
	for (const { version, entries, blobs = [] } of versions) {
		const links = entries.filter((e) => "origin" in e);
		const input = {
			version,
			question: docWith(...entries),
			files: Object.fromEntries(
				links.map((entry, i) => [entry.name, sha256(blobs[i] as Buffer)]),
			),
			blobs: Object.fromEntries(blobs.map((bytes) => [sha256(bytes), bytes])),
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

/// Creates exam `slug`; it opens `opensInMinutes` from now (negative: already open).
function createExam(
	ctx: Ctx,
	write: {
		slug?: string;
		opensInMinutes?: number;
		attachments?: Entry[];
		files?: Record<string, string>;
		blobs?: Record<string, Buffer>;
		questions?: { slug: string; version?: string | null }[];
	} = {},
) {
	return db.exam.create(
		{
			course: ctx.course.id,
			slug: write.slug ?? "ex1",
			title: "Exam",
			type: "EXAM",
			status: "SCHEDULED",
			scheduledAt: fromNow(write.opensInMinutes ?? -10),
			duration: { minutes: 60 },
			...(write.questions ? { questions: write.questions } : {}),
			...(write.attachments ? { attachments: write.attachments } : {}),
			...(write.files ? { files: write.files } : {}),
			...(write.blobs ? { blobs: write.blobs } : {}),
		},
		ctx.opts,
	);
}

function openExam(ctx: Ctx, slug = "ex1") {
	return db.exam.update(
		{ course: ctx.course.id, slug },
		{ scheduledAt: fromNow(-10) },
		ctx.opts,
	);
}

/// The exam with `names` as link attachments, one fresh blob each.
function examWriteWith(...names: string[]) {
	const made = names.map((name) => ({ name, ...blob(name) }));
	return {
		made,
		write: {
			attachments: names.map(link),
			files: Object.fromEntries(made.map((m) => [m.name, m.hash])),
			blobs: Object.fromEntries(made.map((m) => [m.hash, m.bytes])),
		},
	};
}

// -----------------------------------------------------------------------------
// C1 to C3: question writes

test("C1: a multipart PUT of a question stores the file; the full read shows files and the route serves the bytes", async ({
	request,
}) => {
	const ctx = await setup();
	const headers = await tokenFor(request, ctx.instructor.username);
	const h1 = blob();

	const put = await request.put(ctx.questionUrl, {
		headers,
		multipart: multipart(
			{
				slug: "q1",
				status: "PUBLISHED",
				version: "v1",
				question: docWith(link("data.csv")),
				files: { "data.csv": h1.hash },
			},
			h1.bytes,
		),
	});
	expect(put.status()).toBe(200);

	const full = await request.get(`${ctx.questionUrl}/q1`, { headers });
	expect(full.status()).toBe(200);
	expect((await full.json()).files).toEqual({ "data.csv": h1.hash });

	const publicId = await publicIdOf(ctx, "q1");
	const download = await request.get(
		`/api/question/${publicId}/attachment/data.csv`,
		{ headers },
	);
	expect(download.status()).toBe(200);
	expect(Buffer.from(await download.body())).toEqual(h1.bytes);
});

test("C2: a JSON PUT without attachments works, and so does one whose files cite a blob that is already stored", async ({
	request,
}) => {
	const ctx = await setup();
	const headers = await tokenFor(request, ctx.instructor.username);
	const h1 = blob();
	const first = await request.put(ctx.questionUrl, {
		headers,
		multipart: multipart(
			{
				slug: "q1",
				status: "PUBLISHED",
				version: "v1",
				question: docWith(link("data.csv")),
				files: { "data.csv": h1.hash },
			},
			h1.bytes,
		),
	});
	expect(first.status()).toBe(200);

	const plain = await request.put(ctx.questionUrl, {
		headers,
		data: {
			slug: "plain",
			status: "PUBLISHED",
			version: "v1",
			question: docWith(),
		},
	});
	expect(plain.status()).toBe(200);

	const reuse = await request.put(ctx.questionUrl, {
		headers,
		data: {
			slug: "reuse",
			status: "PUBLISHED",
			version: "v1",
			question: docWith(link("data.csv")),
			files: { "data.csv": h1.hash },
		},
	});
	expect(reuse.status()).toBe(200);
	const publicId = await publicIdOf(ctx, "reuse");
	const download = await request.get(
		`/api/question/${publicId}/attachment/data.csv`,
		{ headers },
	);
	expect(Buffer.from(await download.body())).toEqual(h1.bytes);
});

test("C3: a part that does not match its name, a part nobody cites and a missing blob are refused and nothing is stored", async ({
	request,
}) => {
	const ctx = await setup();
	const headers = await tokenFor(request, ctx.instructor.username);
	const claimed = blob("claimed");
	const stray = blob("stray");
	const absent = blob("absent");
	const body = (slug: string, files: Record<string, string>) => ({
		slug,
		status: "PUBLISHED",
		version: "v1",
		question: docWith(link("data.csv")),
		files,
	});

	const mismatch = await request.put(ctx.questionUrl, {
		headers,
		multipart: {
			json: JSON.stringify(body("mismatch", { "data.csv": claimed.hash })),
			[claimed.hash]: {
				name: "file",
				mimeType: "application/octet-stream",
				buffer: Buffer.from("tampered"),
			},
		},
	});
	expect(mismatch.status()).toBe(400);

	const uncited = await request.put(ctx.questionUrl, {
		headers,
		multipart: multipart(
			{
				slug: "uncited",
				status: "PUBLISHED",
				version: "v1",
				question: docWith(),
			},
			stray.bytes,
		),
	});
	expect(uncited.status()).toBe(400);

	const missing = await request.put(ctx.questionUrl, {
		headers,
		data: body("missing", { "data.csv": absent.hash }),
	});
	expect(missing.status()).toBe(404);

	for (const slug of ["mismatch", "uncited", "missing"]) {
		const read = await request.get(`${ctx.questionUrl}/${slug}`, { headers });
		expect(read.status(), slug).toBe(404);
	}
	for (const { hash } of [claimed, stray, absent]) {
		expect(await blobRow(hash)).toBeNull();
	}
});

// -----------------------------------------------------------------------------
// C4: exam write

test("C4: a multipart PUT of an exam stores attachments with origin and files", async ({
	request,
}) => {
	const ctx = await setup();
	const headers = await tokenFor(request, ctx.instructor.username);
	const h1 = blob();
	const attachments = [fenced("n.txt", "read me"), link("a.csv")];

	const put = await request.put(ctx.examUrl, {
		headers,
		multipart: multipart(
			{
				slug: "ex1",
				title: "Exam",
				attachments,
				files: { "a.csv": h1.hash },
			},
			h1.bytes,
		),
	});
	expect(put.status()).toBe(200);

	const read = await request.get(`${ctx.examUrl}/ex1`, { headers });
	expect(read.status()).toBe(200);
	const exam = await read.json();
	expect(exam.attachments).toEqual(attachments);
	expect(exam.files).toEqual({ "a.csv": h1.hash });
});

// -----------------------------------------------------------------------------
// C6 to C9: downloads

test("C6: the exam attachment route is 404 to a student before the exam opens and serves it afterwards, with safe headers", async ({
	request,
}) => {
	const ctx = await setup();
	const { made, write } = examWriteWith("a.csv");
	const h1 = made[0] as (typeof made)[number];
	await createExam(ctx, {
		opensInMinutes: 30,
		...write,
		attachments: [...write.attachments, fenced("n.txt", "plain notes")],
	});
	const url = `${ctx.examUrl}/ex1/attachment`;
	const asStudent = await tokenFor(request, ctx.student.username);
	const asInstructor = await tokenFor(request, ctx.instructor.username);

	expect(
		(await request.get(`${url}/a.csv`, { headers: asStudent })).status(),
	).toBe(404);
	expect(
		(await request.get(`${url}/a.csv`, { headers: ANONYMOUS })).status(),
	).toBe(404);
	const author = await request.get(`${url}/a.csv`, { headers: asInstructor });
	expect(author.status()).toBe(200);
	expect(Buffer.from(await author.body())).toEqual(h1.bytes);

	await openExam(ctx);

	const csv = await request.get(`${url}/a.csv`, { headers: asStudent });
	expect(csv.status()).toBe(200);
	expect(Buffer.from(await csv.body())).toEqual(h1.bytes);
	const headers = csv.headers();
	expect(headers["content-type"]).toContain("text/csv");
	expect(headers["content-disposition"]).toContain('filename="a.csv"');
	expect(headers["x-content-type-options"]).toBe("nosniff");
	expect(headers["referrer-policy"]).toBe("no-referrer");
	for (const [name, value] of Object.entries(headers)) {
		expect(value, name).not.toContain(h1.hash);
	}

	const notes = await request.get(`${url}/n.txt`, { headers: asStudent });
	expect(notes.status()).toBe(200);
	expect(notes.headers()["content-type"]).toBe("text/plain; charset=utf-8");
	expect(await notes.text()).toBe("plain notes");
});

test("C7: the question-of-the-exam route serves the version the exam pins, only once the exam is open and only for its questions", async ({
	request,
}) => {
	const ctx = await setup();
	const v1 = blob("v1");
	const v2 = blob("v2");
	await createQuestion(ctx, "q", [
		{ version: "v1", entries: [link("data.csv")], blobs: [v1.bytes] },
		{ version: "v2", entries: [link("data.csv")], blobs: [v2.bytes] },
	]);
	await createQuestion(ctx, "other", [
		{ version: "v1", entries: [link("data.csv")], blobs: [blob().bytes] },
	]);
	await createExam(ctx, {
		opensInMinutes: 30,
		questions: [{ slug: "q", version: "v1" }],
	});
	const url = `${ctx.examUrl}/ex1/question`;
	const asStudent = await tokenFor(request, ctx.student.username);

	const before = await request.get(`${url}/q/attachment/data.csv`, {
		headers: asStudent,
	});
	expect(before.status()).toBe(404);

	await openExam(ctx);

	const after = await request.get(`${url}/q/attachment/data.csv`, {
		headers: asStudent,
	});
	expect(after.status()).toBe(200);
	expect(Buffer.from(await after.body())).toEqual(v1.bytes);
	const outside = await request.get(`${url}/other/attachment/data.csv`, {
		headers: asStudent,
	});
	expect(outside.status()).toBe(404);
});

test("C8: the question route gives an author any version, the latest by default, 404 for an unknown label and for a student", async ({
	request,
}) => {
	const ctx = await setup();
	const v1 = blob("v1");
	const v2 = blob("v2");
	await createQuestion(ctx, "q", [
		{ version: "v1", entries: [link("data.csv")], blobs: [v1.bytes] },
		{ version: "v2", entries: [link("data.csv")], blobs: [v2.bytes] },
	]);
	const publicId = await publicIdOf(ctx, "q");
	const url = `/api/question/${publicId}/attachment/data.csv`;
	const asInstructor = await tokenFor(request, ctx.instructor.username);
	const asStudent = await tokenFor(request, ctx.student.username);

	const old = await request.get(`${url}?version=v1`, { headers: asInstructor });
	expect(old.status()).toBe(200);
	expect(Buffer.from(await old.body())).toEqual(v1.bytes);
	const latest = await request.get(url, { headers: asInstructor });
	expect(Buffer.from(await latest.body())).toEqual(v2.bytes);
	const unknown = await request.get(`${url}?version=nope`, {
		headers: asInstructor,
	});
	expect(unknown.status()).toBe(404);
	const student = await request.get(url, { headers: asStudent });
	expect(student.status()).toBe(404);
});

test("C9: names are the exact MDQ names: a literal %20, non-ASCII and case all survive the URL", async ({
	request,
}) => {
	const ctx = await setup();
	const names = ["a%20b.csv", "dados-ção.csv", "Data.csv", "data.csv"];
	const { made, write } = examWriteWith(...names);
	await createExam(ctx, write);
	const url = `${ctx.examUrl}/ex1/attachment`;
	const headers = await tokenFor(request, ctx.instructor.username);
	const bytesOf = (name: string) =>
		(made.find((m) => m.name === name) as (typeof made)[number]).bytes;

	const literal = await request.get(`${url}/a%2520b.csv`, { headers });
	expect(literal.status()).toBe(200);
	expect(literal.headers()["content-disposition"]).toContain(
		'filename="a%20b.csv"',
	);
	expect(Buffer.from(await literal.body())).toEqual(bytesOf("a%20b.csv"));

	const decoded = await request.get(`${url}/a%20b.csv`, { headers });
	expect(decoded.status()).toBe(404);

	const unicode = await request.get(
		`${url}/${encodeURIComponent("dados-ção.csv")}`,
		{ headers },
	);
	expect(unicode.status()).toBe(200);
	expect(Buffer.from(await unicode.body())).toEqual(bytesOf("dados-ção.csv"));
	expect(unicode.headers()["content-disposition"]).toContain(
		"filename*=UTF-8''dados-%C3%A7%C3%A3o.csv",
	);

	const upper = await request.get(`${url}/Data.csv`, { headers });
	const lower = await request.get(`${url}/data.csv`, { headers });
	expect(Buffer.from(await upper.body())).toEqual(bytesOf("Data.csv"));
	expect(Buffer.from(await lower.body())).toEqual(bytesOf("data.csv"));
	expect(bytesOf("Data.csv")).not.toEqual(bytesOf("data.csv"));
});

// -----------------------------------------------------------------------------
// C10: no hash reaches a student

test("C10: no student page, read model or ETag carries the hash of an attachment, before or after the exam opens", async ({
	page,
	request,
}) => {
	const ctx = await setup();
	const q1 = blob("q1");
	const q2 = blob("q2");
	await createQuestion(ctx, "q", [
		{ version: "v1", entries: [link("data.csv")], blobs: [q1.bytes] },
		{ version: "v2", entries: [link("data.csv")], blobs: [q2.bytes] },
	]);
	const { made, write } = examWriteWith("a.csv");
	const examHash = (made[0] as (typeof made)[number]).hash;
	await createExam(ctx, {
		opensInMinutes: 30,
		questions: [{ slug: "q", version: "v1" }],
		...write,
	});
	const secrets = [q1.hash, q2.hash, examHash];
	const asStudent = await tokenFor(request, ctx.student.username);
	await logInAs(page, ctx.student);
	const pageUrl = `/${ctx.discipline}/${ctx.courseSegment}/exams/ex1`;

	async function expectClean(stage: string) {
		const bodies: [string, string][] = [];
		const html = await page.goto(pageUrl);
		bodies.push([`${stage} exam page`, (await html?.text()) ?? ""]);
		for (const [label, url] of [
			["exam JSON", `${ctx.examUrl}/ex1`],
			["question JSON", `${ctx.questionUrl}/q?public=true`],
		] as const) {
			const res = await request.get(url, { headers: asStudent });
			expect(res.ok(), `${stage} ${label}`).toBe(true);
			bodies.push([`${stage} ${label}`, await res.text()]);
			bodies.push([`${stage} ${label} etag`, res.headers().etag ?? ""]);
		}
		for (const [label, body] of bodies) {
			for (const secret of secrets) expect(body, label).not.toContain(secret);
		}
	}

	await expectClean("before");
	await openExam(ctx);
	await db.response.create(
		{
			course: ctx.course.id,
			exam: "ex1",
			author: ctx.student.username,
		},
		{ actor: ctx.student },
	);
	await expectClean("after");

	const attempt = await page.goto(
		`${pageUrl}/attempts/${ctx.student.username}`,
	);
	const attemptBody = (await attempt?.text()) ?? "";
	for (const secret of secrets) expect(attemptBody).not.toContain(secret);
});
