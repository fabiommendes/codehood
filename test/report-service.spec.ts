import { expect, test } from "@playwright/test";
import { FULL_ACCESS, type UserActor } from "@/auth/actor";
import { InvalidData, TooManyRequests } from "@/core/error";
import {
	isoDate,
	REPORT_DAILY_LIMIT,
	REPORT_MAX_ATTACHMENT_BYTES,
} from "@/core/schemas";
import { db, type Report, type ReportCreate, type User } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedUserFactory } from "@/fixtures/user.factory";

// Random suffix, not an incrementing counter: slugs and bytes would otherwise
// collide with the ones sibling spec files draw from the shared test database.
function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

const HOUR = 60 * 60 * 1000;

function actorOf(user: Pick<User, "username" | "name" | "role">): {
	actor: UserActor;
} {
	return {
		actor: { username: user.username, name: user.name, role: user.role },
	};
}

async function ensureEdition(slug = "2093-1"): Promise<string> {
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

/// A course with its own instructor, a student, an admin and an outsider.
async function setup() {
	const instructor = await persistedUserFactory.create({ role: "INSTRUCTOR" });
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
		edition: await ensureEdition(),
	});
	const student = await persistedUserFactory.create({ role: "STUDENT" });
	const outsider = await persistedUserFactory.create({ role: "STUDENT" });
	const admin = await persistedUserFactory.create({ role: "ADMIN" });
	return { course, instructor, student, outsider, admin };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

function message(): string {
	return `Something looks wrong here ${tag("m")}`;
}

function send(
	author: Pick<User, "username" | "name" | "role">,
	input: Partial<ReportCreate> = {},
) {
	return db.report.create(
		{ kind: "BUG", message: message(), ...input } as ReportCreate,
		actorOf(author),
	);
}

function image(size = 64): Buffer {
	const head = Buffer.from(tag("img-"));
	return Buffer.concat([head, Buffer.alloc(Math.max(0, size - head.length))]);
}

// -----------------------------------------------------------------------------
// create

test("create opens a report authored by the actor, untriaged", async () => {
	const ctx = await setup();

	const report = await send(ctx.student, {
		kind: "CONTENT",
		course: ctx.course.id,
		url: "http://localhost/cs101/x/exam/1",
		userAgent: "Mozilla/5.0",
		viewport: "1280x720",
	});

	expect(report).toMatchObject({
		kind: "CONTENT",
		status: "OPEN",
		author: ctx.student.username,
		course: {
			discipline: ctx.course.discipline.slug,
			instructor: ctx.instructor.username,
			edition: ctx.course.edition.slug,
		},
		url: "http://localhost/cs101/x/exam/1",
		userAgent: "Mozilla/5.0",
		viewport: "1280x720",
		triagedBy: null,
		triagedAt: null,
		attachments: [],
	});
	expect(report.publicId).toBeTruthy();
});

test("create refuses CONTENT without a course", async () => {
	const ctx = await setup();
	await expect(send(ctx.student, { kind: "CONTENT" })).rejects.toBeInstanceOf(
		InvalidData,
	);
});

test("create refuses a message that is too short once trimmed", async () => {
	const ctx = await setup();
	await expect(
		send(ctx.student, { message: "   short    " }),
	).rejects.toBeInstanceOf(InvalidData);
});

test("create refuses the 11th report of an author within 24 hours, and older reports do not count", async () => {
	const ctx = await setup();
	const sent = [];
	for (let i = 0; i < REPORT_DAILY_LIMIT; i++)
		sent.push(await send(ctx.student));

	const refused = await send(ctx.student).catch((e) => e);
	expect(refused).toBeInstanceOf(TooManyRequests);
	expect(refused.status).toBe(429);

	// Another author is not held back by this one's reports.
	await expect(send(ctx.outsider)).resolves.toBeTruthy();

	// Arrange: the oldest report leaves the 24-hour window.
	await prisma.report.update({
		where: { publicId: (sent[0] as Report).publicId },
		data: { createdAt: new Date(Date.now() - 25 * HOUR) },
	});
	await expect(send(ctx.student)).resolves.toBeTruthy();
});

// -----------------------------------------------------------------------------
// attachments

test("create stores image attachments, served back with the mime type of their extension", async () => {
	const ctx = await setup();
	const png = image();
	const jpg = image();

	const report = await send(ctx.student, {
		attachments: [
			{ filename: "screenshot.png", bytes: png },
			{ filename: "photo.JPG", bytes: jpg },
		],
	});

	expect(report.attachments).toHaveLength(2);
	const byName = Object.fromEntries(
		report.attachments.map((a) => [a.filename, a]),
	);
	expect(byName["screenshot.png"]).toMatchObject({
		mimeType: "image/png",
		size: png.length,
		url: `/api/report/${report.publicId}/attachment/screenshot.png`,
	});
	expect(byName["photo.jpg"]).toMatchObject({ mimeType: "image/jpeg" });

	const served = await db.report.attachment(
		{ publicId: report.publicId },
		"screenshot.png",
		actorOf(ctx.student),
	);
	expect(served.mimeType).toBe("image/png");
	expect(Buffer.from(served.bytes)).toEqual(png);
});

test("create gives two attachments with the same name distinct names", async () => {
	const ctx = await setup();
	const first = image();
	const second = image();

	const report = await send(ctx.student, {
		attachments: [
			{ filename: "image.png", bytes: first },
			{ filename: "image.png", bytes: second },
		],
	});

	const names = report.attachments.map((a) => a.filename);
	expect(new Set(names).size).toBe(2);
	expect(names).toContain("image.png");

	const served = await Promise.all(
		names.map((name) =>
			db.report.attachment(
				{ publicId: report.publicId },
				name,
				actorOf(ctx.student),
			),
		),
	);
	expect(served.map((s) => Buffer.from(s.bytes)).sort(Buffer.compare)).toEqual(
		[first, second].sort(Buffer.compare),
	);
});

test("create accepts an attachment of exactly the limit and refuses one byte more", async () => {
	const ctx = await setup();

	await expect(
		send(ctx.student, {
			attachments: [
				{ filename: "a.webp", bytes: image(REPORT_MAX_ATTACHMENT_BYTES) },
			],
		}),
	).resolves.toBeTruthy();

	await expect(
		send(ctx.student, {
			attachments: [
				{ filename: "b.webp", bytes: image(REPORT_MAX_ATTACHMENT_BYTES + 1) },
			],
		}),
	).rejects.toBeInstanceOf(InvalidData);
});

for (const filename of ["drawing.svg", "anim.gif", "page.html", "noext"]) {
	test(`create refuses a non-image attachment: ${filename}`, async () => {
		const ctx = await setup();
		await expect(
			send(ctx.student, { attachments: [{ filename, bytes: image() }] }),
		).rejects.toBeInstanceOf(InvalidData);
	});
}

test("a refused create stores nothing", async () => {
	const ctx = await setup();
	await send(ctx.student, {
		attachments: [
			{ filename: "ok.png", bytes: image() },
			{ filename: "bad.svg", bytes: image() },
		],
	}).catch(() => {});

	expect(
		await prisma.report.count({ where: { authorId: ctx.student.username } }),
	).toBe(0);
});

// -----------------------------------------------------------------------------
// read visibility

async function arrangeReadCases(ctx: Ctx) {
	const otherCourse = await persistedCourseFactory.create({
		edition: await ensureEdition(),
	});
	const content = await send(ctx.student, {
		kind: "CONTENT",
		course: ctx.course.id,
	});
	const bugInCourse = await send(ctx.student, {
		kind: "BUG",
		course: ctx.course.id,
	});
	const contentElsewhere = await send(ctx.student, {
		kind: "CONTENT",
		course: otherCourse.id,
	});
	return { content, bugInCourse, contentElsewhere };
}

async function canRead(
	who: Pick<User, "username" | "name" | "role">,
	publicId: string,
) {
	return (await db.report.findOne({ publicId }, actorOf(who))) !== null;
}

test("findOne: the author reads their own reports, anyone outside gets null", async () => {
	const ctx = await setup();
	const r = await arrangeReadCases(ctx);

	for (const report of Object.values(r)) {
		expect(await canRead(ctx.student, report.publicId)).toBe(true);
		expect(await canRead(ctx.outsider, report.publicId)).toBe(false);
	}
});

test("findOne: the instructor reads only the CONTENT reports of their own course", async () => {
	const ctx = await setup();
	const r = await arrangeReadCases(ctx);

	expect(await canRead(ctx.instructor, r.content.publicId)).toBe(true);
	expect(await canRead(ctx.instructor, r.bugInCourse.publicId)).toBe(false);
	expect(await canRead(ctx.instructor, r.contentElsewhere.publicId)).toBe(
		false,
	);
});

test("findOne: an admin reads every report", async () => {
	const ctx = await setup();
	const r = await arrangeReadCases(ctx);

	for (const report of Object.values(r)) {
		expect(await canRead(ctx.admin, report.publicId)).toBe(true);
	}
});

test("attachment is NotFound for whoever cannot read the report, and for an unknown name", async () => {
	const ctx = await setup();
	const report = await send(ctx.student, {
		attachments: [{ filename: "s.png", bytes: image() }],
	});

	await expect(
		db.report.attachment(
			{ publicId: report.publicId },
			"s.png",
			actorOf(ctx.outsider),
		),
	).rejects.toMatchObject({ status: 404 });
	await expect(
		db.report.attachment(
			{ publicId: report.publicId },
			"other.png",
			actorOf(ctx.student),
		),
	).rejects.toMatchObject({ status: 404 });
	await expect(
		db.report.attachment(
			{ publicId: report.publicId },
			"s.png",
			actorOf(ctx.admin),
		),
	).resolves.toBeTruthy();
});

// -----------------------------------------------------------------------------
// triage

function triage(
	who: Pick<User, "username" | "name" | "role">,
	publicId: string,
	input: Parameters<typeof db.report.update>[1],
) {
	return db.report.update({ publicId }, input, actorOf(who));
}

test("leaving OPEN records who triaged and when; going back to OPEN clears both", async () => {
	const ctx = await setup();
	const report = await send(ctx.student, {
		kind: "CONTENT",
		course: ctx.course.id,
	});
	const before = Date.now();

	const triaged = await triage(ctx.instructor, report.publicId, {
		status: "TRIAGED",
		note: "Fix the answer key of question 3",
	});
	expect(triaged).toMatchObject({
		status: "TRIAGED",
		note: "Fix the answer key of question 3",
		triagedBy: ctx.instructor.username,
	});
	expect(triaged.triagedAt?.getTime()).toBeGreaterThanOrEqual(before - 1000);

	const resolved = await triage(ctx.admin, report.publicId, {
		status: "RESOLVED",
	});
	expect(resolved).toMatchObject({
		status: "RESOLVED",
		triagedBy: ctx.admin.username,
		note: "Fix the answer key of question 3",
	});

	const reopened = await triage(ctx.admin, report.publicId, {
		status: "OPEN",
	});
	expect(reopened).toMatchObject({
		status: "OPEN",
		triagedBy: null,
		triagedAt: null,
	});
});

test("the author never sees the note, the triager does", async () => {
	const ctx = await setup();
	const report = await send(ctx.student);
	await triage(ctx.admin, report.publicId, {
		status: "DISMISSED",
		note: "Works as intended",
	});

	const asAuthor = await db.report.findOne(
		{ publicId: report.publicId },
		actorOf(ctx.student),
	);
	expect(asAuthor?.status).toBe("DISMISSED");
	expect(asAuthor).not.toHaveProperty("note");

	const asAdmin = await db.report.findOne(
		{ publicId: report.publicId },
		actorOf(ctx.admin),
	);
	expect(asAdmin?.note).toBe("Works as intended");
});

test("the author cannot triage their own report: NotAllowed, nothing changes", async () => {
	const ctx = await setup();
	const report = await send(ctx.student);

	await expect(
		triage(ctx.student, report.publicId, { status: "RESOLVED" }),
	).rejects.toMatchObject({ status: 403 });

	const after = await db.report.findOne(
		{ publicId: report.publicId },
		FULL_ACCESS,
	);
	expect(after?.status).toBe("OPEN");
});

test("whoever cannot read a report gets NotFound on triage", async () => {
	const ctx = await setup();
	const r = await arrangeReadCases(ctx);

	for (const [who, publicId] of [
		[ctx.outsider, r.content.publicId],
		[ctx.instructor, r.bugInCourse.publicId],
		[ctx.instructor, r.contentElsewhere.publicId],
	] as const) {
		await expect(
			triage(who, publicId, { status: "TRIAGED" }),
		).rejects.toMatchObject({ status: 404 });
	}
});

test("kind cannot become CONTENT on a report without a course", async () => {
	const ctx = await setup();
	const report = await send(ctx.student, { kind: "BUG" });

	await expect(
		triage(ctx.admin, report.publicId, { kind: "CONTENT" }),
	).rejects.toBeInstanceOf(InvalidData);

	const withCourse = await send(ctx.student, {
		kind: "BUG",
		course: ctx.course.id,
	});
	await expect(
		triage(ctx.admin, withCourse.publicId, { kind: "CONTENT" }),
	).resolves.toMatchObject({ kind: "CONTENT" });
});

test("an instructor who reclassifies a CONTENT report hands it to the admin and stops seeing it", async () => {
	const ctx = await setup();
	const report = await send(ctx.student, {
		kind: "CONTENT",
		course: ctx.course.id,
	});

	await triage(ctx.instructor, report.publicId, { kind: "BUG" });

	expect(await canRead(ctx.instructor, report.publicId)).toBe(false);
	const asAdmin = await db.report.findOne(
		{ publicId: report.publicId },
		actorOf(ctx.admin),
	);
	expect(asAdmin).toMatchObject({ kind: "BUG", status: "OPEN" });
});

// -----------------------------------------------------------------------------
// delete

test("the author deletes a report while OPEN, and not once it was triaged", async () => {
	const ctx = await setup();
	const open = await send(ctx.student);
	await db.report.delete({ publicId: open.publicId }, actorOf(ctx.student));
	expect(
		await db.report.findOne({ publicId: open.publicId }, FULL_ACCESS),
	).toBeNull();

	const triaged = await send(ctx.student);
	await triage(ctx.admin, triaged.publicId, { status: "TRIAGED" });
	await expect(
		db.report.delete({ publicId: triaged.publicId }, actorOf(ctx.student)),
	).rejects.toMatchObject({ status: 403 });
	expect(
		await db.report.findOne({ publicId: triaged.publicId }, FULL_ACCESS),
	).not.toBeNull();
});

test("the instructor cannot delete a CONTENT report of their course; an admin can delete a triaged one", async () => {
	const ctx = await setup();
	const report = await send(ctx.student, {
		kind: "CONTENT",
		course: ctx.course.id,
	});
	await triage(ctx.instructor, report.publicId, { status: "TRIAGED" });

	await expect(
		db.report.delete({ publicId: report.publicId }, actorOf(ctx.instructor)),
	).rejects.toMatchObject({ status: 403 });

	await db.report.delete({ publicId: report.publicId }, actorOf(ctx.admin));
	expect(
		await db.report.findOne({ publicId: report.publicId }, FULL_ACCESS),
	).toBeNull();
});

test("delete releases the report's attachments", async () => {
	const ctx = await setup();
	const report = await send(ctx.student, {
		attachments: [{ filename: "s.png", bytes: image() }],
	});

	await db.report.delete({ publicId: report.publicId }, actorOf(ctx.student));

	const left = await db.attachment.findMany(
		{ type: "REPORT", attachedTo: [report.id] },
		FULL_ACCESS,
	);
	expect(left).toEqual([]);
});

// -----------------------------------------------------------------------------
// cascades and garbage collection

async function reportAttachmentHashes(reportId: number) {
	const rows = await prisma.attachment.findMany({
		where: { attachedToType: "REPORT", attachedToId: reportId },
		select: { hash: true },
	});
	return rows.map((r) => r.hash);
}

function collectEverything() {
	return db.blob.collectGarbage({
		...FULL_ACCESS,
		olderThan: new Date(Date.now() + HOUR),
	});
}

test("deleting a course deletes its reports, and the GC then takes their attachments and blobs", async () => {
	const ctx = await setup();
	const report = await send(ctx.student, {
		kind: "CONTENT",
		course: ctx.course.id,
		attachments: [{ filename: "s.png", bytes: image() }],
	});
	const [hash] = await reportAttachmentHashes(report.id);
	expect(hash).toBeTruthy();

	await db.course.delete({ id: ctx.course.id }, FULL_ACCESS);
	expect(
		await db.report.findOne({ publicId: report.publicId }, FULL_ACCESS),
	).toBeNull();

	const collected = await collectEverything();
	expect(collected).toContain(hash);
	expect(await reportAttachmentHashes(report.id)).toEqual([]);
});

test("deleting the author deletes their reports, and the GC then takes the attachments", async () => {
	const ctx = await setup();
	const report = await send(ctx.student, {
		attachments: [{ filename: "s.png", bytes: image() }],
	});
	const [hash] = await reportAttachmentHashes(report.id);

	await db.user.delete({ username: ctx.student.username }, FULL_ACCESS);
	expect(
		await db.report.findOne({ publicId: report.publicId }, FULL_ACCESS),
	).toBeNull();

	expect(await collectEverything()).toContain(hash);
});

test("deleting a course also lets the GC take the attachments of its resources", async () => {
	const ctx = await setup();
	const resource = await db.resource.create(
		{
			course: ctx.course.id,
			slug: tag("res-"),
			title: "Notes",
			description: "Notes",
			data: { type: "LINK", url: "https://example.com" },
			rev: "0".repeat(40),
		},
		FULL_ACCESS,
	);
	const attachment = await db.attachment.create(
		{
			buffer: image(),
			filename: "notes.pdf",
			attachedTo: { type: "RESOURCE", id: resource.id },
		},
		FULL_ACCESS,
	);

	await db.course.delete({ id: ctx.course.id }, FULL_ACCESS);

	expect(await collectEverything()).toContain(attachment.hash);
});

test("the GC keeps the attachments of a report that still exists", async () => {
	const ctx = await setup();
	const report = await send(ctx.student, {
		attachments: [{ filename: "s.png", bytes: image() }],
	});
	const [hash] = await reportAttachmentHashes(report.id);

	expect(await collectEverything()).not.toContain(hash);
	await expect(
		db.report.attachment(
			{ publicId: report.publicId },
			"s.png",
			actorOf(ctx.student),
		),
	).resolves.toBeTruthy();
});

test("deleting whoever triaged a report keeps the report and clears triagedBy", async () => {
	const ctx = await setup();
	const triager = await persistedUserFactory.create({ role: "ADMIN" });
	const report = await send(ctx.student);
	await triage(triager, report.publicId, { status: "TRIAGED" });

	await db.user.delete({ username: triager.username }, FULL_ACCESS);

	const after = await db.report.findOne(
		{ publicId: report.publicId },
		FULL_ACCESS,
	);
	expect(after).toMatchObject({ status: "TRIAGED", triagedBy: null });
});

// -----------------------------------------------------------------------------
// findMany

test("findMany returns only what the actor may read, oldest first", async () => {
	const ctx = await setup();
	const r = await arrangeReadCases(ctx);
	const own = await send(ctx.outsider, { kind: "SUGGESTION" });
	const author = ctx.student.username;

	const asStudent = await db.report.findMany({}, actorOf(ctx.student));
	expect(asStudent.map((x) => x.publicId)).toEqual([
		r.content.publicId,
		r.bugInCourse.publicId,
		r.contentElsewhere.publicId,
	]);
	expect(asStudent.every((x) => !("note" in x))).toBe(true);

	const asOutsider = await db.report.findMany({}, actorOf(ctx.outsider));
	expect(asOutsider.map((x) => x.publicId)).toEqual([own.publicId]);

	const asInstructor = await db.report.findMany({}, actorOf(ctx.instructor));
	expect(asInstructor.map((x) => x.publicId)).toEqual([r.content.publicId]);

	const asAdmin = await db.report.findMany({ author }, actorOf(ctx.admin));
	expect(asAdmin.map((x) => x.publicId)).toEqual([
		r.content.publicId,
		r.bugInCourse.publicId,
		r.contentElsewhere.publicId,
	]);
});

test("findMany narrows by status, kind, course and author", async () => {
	const ctx = await setup();
	const r = await arrangeReadCases(ctx);
	await triage(ctx.admin, r.bugInCourse.publicId, { status: "RESOLVED" });
	const author = ctx.student.username;
	const ids = (xs: { publicId: string }[]) => xs.map((x) => x.publicId);
	const asAdmin = actorOf(ctx.admin);

	expect(
		ids(await db.report.findMany({ author, status: ["OPEN"] }, asAdmin)),
	).toEqual([r.content.publicId, r.contentElsewhere.publicId]);
	expect(
		ids(await db.report.findMany({ author, kind: ["BUG"] }, asAdmin)),
	).toEqual([r.bugInCourse.publicId]);
	expect(
		ids(await db.report.findMany({ course: ctx.course.id }, asAdmin)),
	).toEqual([r.content.publicId, r.bugInCourse.publicId]);
	expect(
		ids(
			await db.report.findMany(
				{ author, status: ["OPEN", "RESOLVED"], kind: ["CONTENT"] },
				asAdmin,
			),
		),
	).toEqual([r.content.publicId, r.contentElsewhere.publicId]);
});

test("a triaged report leaves the OPEN queue", async () => {
	const ctx = await setup();
	const report = await send(ctx.student, {
		kind: "CONTENT",
		course: ctx.course.id,
	});
	const queue = () =>
		db.report.findMany(
			{ course: ctx.course.id, status: ["OPEN"] },
			actorOf(ctx.instructor),
		);

	expect((await queue()).map((x) => x.publicId)).toEqual([report.publicId]);
	await triage(ctx.instructor, report.publicId, { status: "TRIAGED" });
	expect(await queue()).toEqual([]);
});

test("countOpen counts the OPEN CONTENT reports of a course", async () => {
	const ctx = await setup();
	const first = await send(ctx.student, {
		kind: "CONTENT",
		course: ctx.course.id,
	});
	await send(ctx.student, { kind: "CONTENT", course: ctx.course.id });
	await send(ctx.student, { kind: "BUG", course: ctx.course.id });
	expect(
		await db.report.countOpen(ctx.course.id, actorOf(ctx.instructor)),
	).toBe(2);

	await triage(ctx.instructor, first.publicId, { status: "TRIAGED" });
	expect(
		await db.report.countOpen(ctx.course.id, actorOf(ctx.instructor)),
	).toBe(1);
});

// -----------------------------------------------------------------------------
// findPage and count

/// Walks every page of `find` forward, then back from the last one, and checks both walks agree.
async function walkPages(
	find: (params: {
		limit: number;
		after?: string;
		before?: string;
	}) => Promise<{
		items: Report[];
		next: string | null;
		prev: string | null;
	}>,
	limit: number,
): Promise<string[][]> {
	const ids = (items: Report[]) => items.map((item) => item.publicId);
	let current = await find({ limit });
	expect(current.prev).toBeNull();
	const forward = [ids(current.items)];
	while (current.next !== null) {
		current = await find({ limit, after: current.next });
		forward.push(ids(current.items));
	}
	const backward = [ids(current.items)];
	while (current.prev !== null) {
		current = await find({ limit, before: current.prev });
		backward.unshift(ids(current.items));
	}
	expect(backward).toEqual(forward);
	return forward;
}

/// Reports of `ctx.student` where the ones the instructor may read alternate with ones they may not.
async function arrangeInterleaved(ctx: Ctx) {
	const visible: Report[] = [];
	const hidden: Report[] = [];
	for (let i = 0; i < 5; i++) {
		visible.push(
			await send(ctx.student, { kind: "CONTENT", course: ctx.course.id }),
		);
		hidden.push(
			await send(ctx.student, { kind: "BUG", course: ctx.course.id }),
		);
	}
	return { visible, hidden };
}

test("findPage gives an actor full pages of only what they may read, and count agrees", async () => {
	const ctx = await setup();
	const { visible, hidden } = await arrangeInterleaved(ctx);
	const own = await send(ctx.instructor, { kind: "SUGGESTION" });
	const asInstructor = actorOf(ctx.instructor);
	const readable = [...visible, own].map((report) => report.publicId);

	const pages = await walkPages(
		(params) => db.report.findPage(params, asInstructor),
		2,
	);
	expect(pages.map((page) => page.length)).toEqual([2, 2, 2]);
	expect(pages.flat()).toEqual(readable);
	expect(await db.report.count({}, asInstructor)).toBe(readable.length);
	expect(
		(await db.report.findMany({}, asInstructor)).map((x) => x.publicId),
	).toEqual(readable);

	const asStudent = actorOf(ctx.student);
	const mine = await walkPages(
		(params) => db.report.findPage(params, asStudent),
		3,
	);
	expect(mine.map((page) => page.length)).toEqual([3, 3, 3, 1]);
	expect(mine.flat()).toHaveLength(visible.length + hidden.length);
	expect(await db.report.count({}, asStudent)).toBe(10);
	const first = await db.report.findPage({ limit: 3 }, asStudent);
	expect(first.items.every((item) => !("note" in item))).toBe(true);

	const asOutsider = actorOf(ctx.outsider);
	expect(await db.report.findPage({ limit: 2 }, asOutsider)).toEqual({
		items: [],
		next: null,
		prev: null,
	});
	expect(await db.report.count({}, asOutsider)).toBe(0);
});

test("findPage keeps the filter on every page, and count agrees with it", async () => {
	const ctx = await setup();
	const { visible, hidden } = await arrangeInterleaved(ctx);
	const author = ctx.student.username;
	const asAdmin = actorOf(ctx.admin);
	for (const report of [visible[1], visible[3], hidden[0]]) {
		await triage(ctx.admin, (report as Report).publicId, {
			status: "RESOLVED",
		});
	}

	const filters = [
		{ author },
		{ author, kind: ["CONTENT" as const] },
		{ author, status: ["OPEN" as const] },
		{ author, status: ["RESOLVED" as const], kind: ["CONTENT" as const] },
		{ author, course: ctx.course.id, kind: ["BUG" as const] },
		{ author, status: ["DISMISSED" as const] },
	];
	for (const filter of filters) {
		const expected = (await db.report.findMany(filter, asAdmin)).map(
			(report) => report.publicId,
		);
		const pages = await walkPages(
			(params) => db.report.findPage({ ...filter, ...params }, asAdmin),
			2,
		);
		expect(pages.flat()).toEqual(expected);
		expect(pages.slice(0, -1).every((page) => page.length === 2)).toBe(true);
		expect(await db.report.count(filter, asAdmin)).toBe(expected.length);
	}

	const instructorQueue = { course: ctx.course.id, status: ["OPEN" as const] };
	const queue = await walkPages(
		(params) =>
			db.report.findPage(
				{ ...instructorQueue, ...params },
				actorOf(ctx.instructor),
			),
		2,
	);
	expect(queue.flat()).toEqual(
		[visible[0], visible[2], visible[4]].map((r) => (r as Report).publicId),
	);
	expect(await db.report.count(instructorQueue, actorOf(ctx.instructor))).toBe(
		3,
	);
});

test("findPage refuses a cursor it did not make, and after together with before", async () => {
	const ctx = await setup();
	await send(ctx.student);
	await send(ctx.student);
	const asAdmin = actorOf(ctx.admin);

	await expect(
		db.report.findPage({ after: "not a cursor" }, asAdmin),
	).rejects.toThrow(InvalidData);
	await expect(
		db.report.findPage({ before: "not a cursor" }, asAdmin),
	).rejects.toThrow(InvalidData);
	const { next } = await db.report.findPage(
		{ author: ctx.student.username, limit: 1 },
		asAdmin,
	);
	expect(next).not.toBeNull();
	await expect(
		db.report.findPage(
			{ after: next as string, before: next as string },
			asAdmin,
		),
	).rejects.toThrow(InvalidData);
});
