import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { InvalidData, NotFound, PreconditionFailed } from "@/core/error";
import type { CourseId } from "@/core/schemas";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { codeAt } from "@/services/roll-call-code";
import { LEGACY } from "./legacy-questions";

/// ADR 0013 for question, gradeColumn, rollCall and the attachments of a
/// resource. Every fixture creates its own rows under unique keys.

let seq = 0;
const uniq = () => `${++seq}-${Math.random().toString(36).slice(2, 7)}`;
const STALE = new Date(0);
const at = (expectedUpdatedAt: Date | null) => ({
	...FULL_ACCESS,
	expectedUpdatedAt,
});

/// Settles a promise to the error it throws, or fails the test.
async function failure(promise: Promise<unknown>): Promise<PreconditionFailed> {
	const err = await promise.then(
		() => null,
		(e: unknown) => e,
	);
	expect(err).toBeInstanceOf(PreconditionFailed);
	return err as PreconditionFailed;
}

async function makeUser(role: "INSTRUCTOR" | "STUDENT") {
	const username = `co-${role[0]?.toLowerCase()}-${uniq()}`;
	return db.user.create(
		{
			email: `${username}@codehood.test`,
			username,
			name: username,
			role,
			password: "x",
			githubId: username,
			schoolId: username,
		},
		FULL_ACCESS,
	);
}

async function makeCourse() {
	const edition = `${6000 + ++seq}-1`;
	await db.edition.create(
		{
			slug: edition,
			name: edition,
			startAt: new Date("2026-01-01"),
			endAt: new Date("2030-12-31"),
		},
		FULL_ACCESS,
	);
	const discipline = `co-d-${uniq()}`;
	await db.discipline.create(
		{ slug: discipline, name: discipline },
		FULL_ACCESS,
	);
	const instructor = await makeUser("INSTRUCTOR");
	const natural = {
		discipline,
		instructor: instructor.username,
		edition,
	};
	const course = await db.course.create(
		{
			...natural,
			startAt: new Date("2026-02-02T00:00:00Z"),
			endAt: new Date("2026-06-01T00:00:00Z"),
		},
		FULL_ACCESS,
	);
	return { id: course.id as CourseId, natural, instructor };
}

async function enrolled(course: CourseId) {
	const student = await makeUser("STUDENT");
	await db.enrollment.create(
		{ course, username: student.username },
		FULL_ACCESS,
	);
	return student;
}

//
// Question
//

type Doc = Parameters<typeof db.question.create>[0]["question"];

const doc = (stem = "Which one?"): Doc => ({
	type: "multiple-choice",
	title: "Q",
	stem,
	tags: ["a", "b"],
	choices: [
		{ id: "x", text: "X", score: 1 },
		{ id: "y", text: "Y" },
	],
});

async function makeQuestion() {
	const { id: course } = await makeCourse();
	const input = {
		course,
		slug: `q-${uniq()}`,
		status: "PUBLISHED" as const,
		version: "v1",
		question: doc(),
	};
	return { q: await db.question.create(input, FULL_ACCESS), input };
}

const versions = (refId: number) =>
	prisma.questionData.count({ where: { refId } });

test("question.update: right version writes a new version and bumps the question", async () => {
	const { q } = await makeQuestion();
	const out = await db.question.update(
		{ id: q.id },
		{ version: "v2", question: doc("Changed?") },
		at(q.updatedAt),
	);
	expect(out.version).toBe("v2");
	expect(out.updatedAt.getTime()).toBeGreaterThan(q.updatedAt.getTime());
	expect(await versions(q.id)).toBe(2);
});

test("question.update: stale version throws with the current one and writes nothing", async () => {
	const { q } = await makeQuestion();
	const err = await failure(
		db.question.update(
			{ id: q.id },
			{ version: "v2", question: doc("Changed?"), status: "HIDDEN" },
			at(STALE),
		),
	);
	expect(err.updatedAt).toEqual(q.updatedAt);
	expect(await versions(q.id)).toBe(1);
	const stored = await prisma.questionRef.findUniqueOrThrow({
		where: { id: q.id },
		include: { questionTags: true },
	});
	expect(stored.status).toBe("PUBLISHED");
	expect(stored.updatedAt).toEqual(q.updatedAt);
	expect(stored.questionTags.map((t) => t.tag).sort()).toEqual(["a", "b"]);
});

test("question.update: a stale version is refused before an archived question's 409", async () => {
	const { q } = await makeQuestion();
	await db.question.delete({ id: q.id }, FULL_ACCESS);
	await failure(db.question.update({ id: q.id }, { rev: "r" }, at(STALE)));
});

test("question.update: absent expectation writes", async () => {
	const { q } = await makeQuestion();
	const out = await db.question.update(
		{ id: q.id },
		{ rev: "r2" },
		FULL_ACCESS,
	);
	expect(out.rev).toBe("r2");
});

test("question.update: a Date on a missing row is a 412 with null, a missing course stays NotFound", async () => {
	const { id: course, natural } = await makeCourse();
	const err = await failure(
		db.question.update({ course, slug: "nope" }, { rev: "r" }, at(new Date())),
	);
	expect(err.updatedAt).toBeNull();
	await expect(
		db.question.update(
			{ course: { ...natural, discipline: "nonexistent-disc" }, slug: "nope" },
			{ rev: "r" },
			at(new Date()),
		),
	).rejects.toBeInstanceOf(NotFound);
});

test("question.upsert: null creates, then fails when it exists", async () => {
	const { id: course } = await makeCourse();
	const input = {
		course,
		slug: `q-${uniq()}`,
		status: "PUBLISHED" as const,
		version: "v1",
		question: doc(),
	};
	const created = await db.question.upsert(input, at(null));
	const err = await failure(db.question.upsert(input, at(null)));
	expect(err.updatedAt).toEqual(created.updatedAt);
});

test("question.upsert: Date updates when right, fails when stale or absent", async () => {
	const { q, input } = await makeQuestion();
	const next = { ...input, version: "v2", question: doc("Next?") };
	await failure(db.question.upsert(next, at(STALE)));
	expect(await versions(q.id)).toBe(1);
	const out = await db.question.upsert(next, at(q.updatedAt));
	expect(out.version).toBe("v2");
	const absent = { ...input, slug: `q-${uniq()}` };
	expect(
		(await failure(db.question.upsert(absent, at(new Date())))).updatedAt,
	).toBeNull();
});

test("question.upsert: an archived question is revived only with its own version", async () => {
	const { q, input } = await makeQuestion();
	await db.question.delete({ id: q.id }, FULL_ACCESS);
	const archived = await prisma.questionRef.findUniqueOrThrow({
		where: { id: q.id },
	});
	await failure(db.question.upsert(input, at(null)));
	await failure(db.question.upsert(input, at(STALE)));
	expect(
		(await prisma.questionRef.findUniqueOrThrow({ where: { id: q.id } }))
			.status,
	).toBe("ARCHIVED");
	const revived = await db.question.upsert(input, at(archived.updatedAt));
	expect(revived.status).toBe("PUBLISHED");
});

test("question.delete: right version archives, stale throws and keeps it", async () => {
	const { q } = await makeQuestion();
	await failure(db.question.delete({ id: q.id }, at(STALE)));
	expect(
		(await prisma.questionRef.findUniqueOrThrow({ where: { id: q.id } }))
			.status,
	).toBe("PUBLISHED");
	await db.question.delete({ id: q.id }, at(q.updatedAt));
	const after = await prisma.questionRef.findUniqueOrThrow({
		where: { id: q.id },
	});
	expect(after.status).toBe("ARCHIVED");
	expect(after.updatedAt.getTime()).toBeGreaterThan(q.updatedAt.getTime());
});

test("question.delete: a Date on a missing row is a 412 with null, none is a NotFound", async () => {
	const { id: course } = await makeCourse();
	const pk = { course, slug: "nope" };
	expect(
		(await failure(db.question.delete(pk, at(new Date())))).updatedAt,
	).toBeNull();
	await expect(db.question.delete(pk, FULL_ACCESS)).rejects.toBeInstanceOf(
		NotFound,
	);
});

test("question.upgradeLegacyVersions bumps the question whose latest version it rewrote", async () => {
	const { q } = await makeQuestion();
	await prisma.questionData.updateMany({
		where: { refId: q.id },
		data: {
			publicPayload: LEGACY.multipleChoice.publicPayload,
			privatePayload: LEGACY.multipleChoice.privatePayload,
		},
	});
	await db.question.upgradeLegacyVersions({}, FULL_ACCESS);
	const after = await prisma.questionRef.findUniqueOrThrow({
		where: { id: q.id },
	});
	expect(after.updatedAt.getTime()).toBeGreaterThan(q.updatedAt.getTime());
});

test("question.upgradeLegacyVersions leaves a current question's version alone", async () => {
	const { q } = await makeQuestion();
	await db.question.upgradeLegacyVersions({}, FULL_ACCESS);
	const after = await prisma.questionRef.findUniqueOrThrow({
		where: { id: q.id },
	});
	expect(after.updatedAt).toEqual(q.updatedAt);
});

//
// Grade column
//

async function makeColumn() {
	const course = await makeCourse();
	const student = await enrolled(course.id);
	const input = {
		course: course.id,
		slug: `gc-${uniq()}`,
		title: "Col",
		kind: "NUMBER" as const,
		position: 0,
		values: [{ username: student.username, value: 5 }],
	};
	return {
		column: await db.gradeColumn.create(input, FULL_ACCESS),
		input,
		student,
		course,
	};
}

test("gradeColumn.update: right version writes and bumps", async () => {
	const { column } = await makeColumn();
	const out = await db.gradeColumn.update(
		{ id: column.id },
		{ title: "New" },
		at(column.updatedAt),
	);
	expect(out.title).toBe("New");
	expect(out.updatedAt.getTime()).toBeGreaterThan(column.updatedAt.getTime());
});

test("gradeColumn.update: stale version throws and replaces no value", async () => {
	const { column, student } = await makeColumn();
	const err = await failure(
		db.gradeColumn.update(
			{ id: column.id },
			{ title: "Nope", values: [{ username: student.username, value: 9 }] },
			at(STALE),
		),
	);
	expect(err.updatedAt).toEqual(column.updatedAt);
	const stored = await db.gradeColumn.findOne({ id: column.id }, FULL_ACCESS);
	expect(stored?.title).toBe("Col");
	expect(stored?.values).toEqual([{ username: student.username, value: 5 }]);
});

test("gradeColumn.update: the values are in the read model, so changing them alone bumps the column", async () => {
	const { column, student } = await makeColumn();
	expect(column.values).toHaveLength(1);
	const out = await db.gradeColumn.update(
		{ id: column.id },
		{ values: [{ username: student.username, value: 7 }] },
		at(column.updatedAt),
	);
	expect(out.values).toEqual([{ username: student.username, value: 7 }]);
	expect(out.updatedAt.getTime()).toBeGreaterThan(column.updatedAt.getTime());
});

test("gradeColumn.update: a Date on a missing row is a 412 with null, a missing course stays NotFound", async () => {
	const { id: course, natural } = await makeCourse();
	const err = await failure(
		db.gradeColumn.update(
			{ course, slug: "nope" },
			{ title: "x" },
			at(new Date()),
		),
	);
	expect(err.updatedAt).toBeNull();
	await expect(
		db.gradeColumn.update(
			{ course: { ...natural, discipline: "nonexistent-disc" }, slug: "nope" },
			{ title: "x" },
			at(new Date()),
		),
	).rejects.toBeInstanceOf(NotFound);
});

test("gradeColumn.upsert: null creates, then fails when it exists", async () => {
	const { course } = await makeColumn();
	const input = {
		course: course.id,
		slug: `gc-${uniq()}`,
		title: "Col",
		kind: "NUMBER" as const,
		position: 0,
		values: [],
	};
	const created = await db.gradeColumn.upsert(input, at(null));
	const err = await failure(db.gradeColumn.upsert(input, at(null)));
	expect(err.updatedAt).toEqual(created.updatedAt);
});

test("gradeColumn.upsert: Date updates when right, fails when stale or absent", async () => {
	const { column, input } = await makeColumn();
	await failure(db.gradeColumn.upsert({ ...input, title: "A" }, at(STALE)));
	const out = await db.gradeColumn.upsert(
		{ ...input, title: "B" },
		at(column.updatedAt),
	);
	expect(out.title).toBe("B");
	const absent = { ...input, slug: `gc-${uniq()}` };
	expect(
		(await failure(db.gradeColumn.upsert(absent, at(new Date())))).updatedAt,
	).toBeNull();
});

test("gradeColumn.delete: right version deletes, stale throws and keeps the values", async () => {
	const { column } = await makeColumn();
	await failure(db.gradeColumn.delete({ id: column.id }, at(STALE)));
	expect(
		await db.gradeColumn.findOne({ id: column.id }, FULL_ACCESS),
	).not.toBeNull();
	await db.gradeColumn.delete({ id: column.id }, at(column.updatedAt));
	expect(
		await db.gradeColumn.findOne({ id: column.id }, FULL_ACCESS),
	).toBeNull();
});

test("gradeColumn.delete: a Date on a missing row is a 412 with null, none is a NotFound", async () => {
	const { id: course } = await makeCourse();
	const pk = { course, slug: "nope" };
	expect(
		(await failure(db.gradeColumn.delete(pk, at(new Date())))).updatedAt,
	).toBeNull();
	await expect(db.gradeColumn.delete(pk, FULL_ACCESS)).rejects.toBeInstanceOf(
		NotFound,
	);
});

test("gradeColumn.release: right version releases and bumps, stale throws", async () => {
	const { column } = await makeColumn();
	await failure(db.gradeColumn.release({ id: column.id }, at(STALE)));
	expect(
		(await db.gradeColumn.findOne({ id: column.id }, FULL_ACCESS))?.releasedAt,
	).toBeNull();
	const out = await db.gradeColumn.release(
		{ id: column.id },
		at(column.updatedAt),
	);
	expect(out.releasedAt).not.toBeNull();
	expect(out.updatedAt.getTime()).toBeGreaterThan(column.updatedAt.getTime());
});

test("gradeColumn.release: an already released column keeps its version, but a stale one is still refused", async () => {
	const { column } = await makeColumn();
	const released = await db.gradeColumn.release({ id: column.id }, FULL_ACCESS);
	await failure(db.gradeColumn.release({ id: column.id }, at(STALE)));
	const again = await db.gradeColumn.release(
		{ id: column.id },
		at(released.updatedAt),
	);
	expect(again.updatedAt).toEqual(released.updatedAt);
});

//
// Roll call
//

async function makeRollCall() {
	const course = await makeCourse();
	const slot = await db.timeSlot.create(
		{
			course: course.id,
			slug: "mon",
			day: "MONDAY",
			start: { hour: 14, minute: 0 },
			duration: { hours: 2 },
		},
		FULL_ACCESS,
	);
	const event = await db.calendarEvent.create(
		{ course: course.id, timeSlot: slot.id, week: 1, title: "Class" },
		FULL_ACCESS,
	);
	const student = await enrolled(course.id);
	const rollCall = await db.rollCall.create(
		{ event: { id: event.id } },
		FULL_ACCESS,
	);
	return { course, event, student, rollCall };
}

test("rollCall.update: right version writes and bumps", async () => {
	const { rollCall } = await makeRollCall();
	const out = await db.rollCall.update(
		{ id: rollCall.id },
		{ actsAsInvite: true },
		at(rollCall.updatedAt),
	);
	expect(out.actsAsInvite).toBe(true);
	expect(out.updatedAt.getTime()).toBeGreaterThan(rollCall.updatedAt.getTime());
});

test("rollCall.update: stale version throws and writes no attendance", async () => {
	const { rollCall, student } = await makeRollCall();
	const err = await failure(
		db.rollCall.update(
			{ id: rollCall.id },
			{ attendances: { [student.username]: {} } },
			at(STALE),
		),
	);
	expect(err.updatedAt).toEqual(rollCall.updatedAt);
	expect(
		await prisma.attendance.count({ where: { rollCallId: rollCall.id } }),
	).toBe(0);
});

test("rollCall.update: the attendances are in the read model, so changing them alone bumps the roll call", async () => {
	const { rollCall, student } = await makeRollCall();
	const marked = await db.rollCall.update(
		{ id: rollCall.id },
		{ attendances: { [student.username]: { note: "a" } } },
		at(rollCall.updatedAt),
	);
	expect(marked.updatedAt.getTime()).toBeGreaterThan(
		rollCall.updatedAt.getTime(),
	);
	const noted = await db.rollCall.update(
		{ id: rollCall.id },
		{ attendances: { [student.username]: { note: "b" } } },
		at(marked.updatedAt),
	);
	expect(noted.updatedAt.getTime()).toBeGreaterThan(marked.updatedAt.getTime());
	const removed = await db.rollCall.update(
		{ id: rollCall.id },
		{ attendances: { [student.username]: null } },
		at(noted.updatedAt),
	);
	expect(removed.updatedAt.getTime()).toBeGreaterThan(
		noted.updatedAt.getTime(),
	);
	expect(removed.attendances).toEqual({});
});

test("rollCall.update: writing the same note or the same actsAsInvite again keeps the version", async () => {
	const { rollCall, student } = await makeRollCall();
	const marked = await db.rollCall.update(
		{ id: rollCall.id },
		{ actsAsInvite: true, attendances: { [student.username]: { note: "a" } } },
		at(rollCall.updatedAt),
	);
	const again = await db.rollCall.update(
		{ id: rollCall.id },
		{ actsAsInvite: true, attendances: { [student.username]: { note: "a" } } },
		at(marked.updatedAt),
	);
	expect(again.updatedAt).toEqual(marked.updatedAt);
	const flipped = await db.rollCall.update(
		{ id: rollCall.id },
		{ actsAsInvite: false },
		at(again.updatedAt),
	);
	expect(flipped.updatedAt.getTime()).toBeGreaterThan(
		again.updatedAt.getTime(),
	);
});

test("rollCall.update: a change that touches nothing keeps the version", async () => {
	const { rollCall, student } = await makeRollCall();
	const out = await db.rollCall.update(
		{ id: rollCall.id },
		{ attendances: { [student.username]: null } },
		at(rollCall.updatedAt),
	);
	expect(out.updatedAt).toEqual(rollCall.updatedAt);
});

test("rollCall.update: a Date on a missing row is a 412 with null, a missing course stays NotFound", async () => {
	const { course } = await makeRollCall();
	const err = await failure(
		db.rollCall.update(
			{ course: course.id, week: 5, timeSlot: "mon" },
			{ actsAsInvite: true },
			at(new Date()),
		),
	);
	expect(err.updatedAt).toBeNull();
	await expect(
		db.rollCall.update(
			{ course: 2_000_000_000 as CourseId, week: 1, timeSlot: "mon" },
			{ actsAsInvite: true },
			at(new Date()),
		),
	).rejects.toBeInstanceOf(NotFound);
});

test("rollCall.delete: right version deletes, stale throws and keeps the attendances", async () => {
	const { rollCall, student } = await makeRollCall();
	await db.rollCall.update(
		{ id: rollCall.id },
		{ attendances: { [student.username]: {} } },
		FULL_ACCESS,
	);
	const current = await db.rollCall.findOne({ id: rollCall.id }, FULL_ACCESS);
	await failure(db.rollCall.delete({ id: rollCall.id }, at(STALE)));
	expect(
		await prisma.attendance.count({ where: { rollCallId: rollCall.id } }),
	).toBe(1);
	await db.rollCall.delete({ id: rollCall.id }, at(current?.updatedAt ?? null));
	expect(
		await db.rollCall.findOne({ id: rollCall.id }, FULL_ACCESS),
	).toBeNull();
});

test("rollCall.delete: a Date on a missing row is a 412 with null, none is a NotFound", async () => {
	const { rollCall } = await makeRollCall();
	await db.rollCall.delete({ id: rollCall.id }, FULL_ACCESS);
	expect(
		(await failure(db.rollCall.delete({ id: rollCall.id }, at(new Date()))))
			.updatedAt,
	).toBeNull();
	await expect(
		db.rollCall.delete({ id: rollCall.id }, FULL_ACCESS),
	).rejects.toBeInstanceOf(NotFound);
});

test("rollCall.open and close: right version writes and bumps, stale throws", async () => {
	const { rollCall } = await makeRollCall();
	await failure(db.rollCall.close({ id: rollCall.id }, at(STALE)));
	await failure(db.rollCall.open({ id: rollCall.id }, at(STALE)));
	const closed = await db.rollCall.close(
		{ id: rollCall.id },
		at(rollCall.updatedAt),
	);
	expect(closed.updatedAt.getTime()).toBeGreaterThan(
		rollCall.updatedAt.getTime(),
	);
	const opened = await db.rollCall.open(
		{ id: rollCall.id },
		at(closed.updatedAt),
	);
	expect(opened.updatedAt.getTime()).toBeGreaterThan(
		closed.updatedAt.getTime(),
	);
});

test("rollCall.checkIn adds an attendance, so it bumps the roll call; a repeat does not", async () => {
	const { rollCall, student } = await makeRollCall();
	const secret = (
		await prisma.rollCall.findUniqueOrThrow({ where: { id: rollCall.id } })
	).secret;
	const input = {
		rollCallId: rollCall.id,
		code: codeAt(secret, new Date()).code,
		deviceId: `dev-${uniq()}`,
	};
	await db.rollCall.checkIn(input, { actor: student });
	const first = await db.rollCall.findOne({ id: rollCall.id }, FULL_ACCESS);
	expect(first?.updatedAt.getTime()).toBeGreaterThan(
		rollCall.updatedAt.getTime(),
	);
	const repeat = await db.rollCall.checkIn(input, { actor: student });
	expect(repeat.repeat).toBe(true);
	const second = await db.rollCall.findOne({ id: rollCall.id }, FULL_ACCESS);
	expect(second?.updatedAt).toEqual(first?.updatedAt);
});

//
// Resource attachments
//

async function makeFileResource() {
	const { id: course } = await makeCourse();
	const resource = await db.resource.create(
		{
			course,
			slug: `f-${uniq()}`,
			title: "File",
			data: { type: "FILE", filename: "a.txt", buffer: Buffer.from(uniq()) },
		},
		FULL_ACCESS,
	);
	const [attachment] = await db.attachment.allAttachedTo(
		{ type: "RESOURCE", id: resource.id } as never,
		FULL_ACCESS,
	);
	if (!attachment) throw new Error("the file has no attachment");
	return { resource, attachment };
}

test("attachment.update of a resource's file bumps the resource and shows the new name", async () => {
	const { resource, attachment } = await makeFileResource();
	await db.attachment.update(
		{ id: attachment.id },
		{ filename: "b.txt" },
		FULL_ACCESS,
	);
	const after = await db.resource.findOne({ id: resource.id }, FULL_ACCESS);
	expect(after?.updatedAt.getTime()).toBeGreaterThan(
		resource.updatedAt.getTime(),
	);
	expect(JSON.stringify(after?.data)).toContain("b.txt");
});

test("attachment refuses an expectation: its rows have no version to check", async () => {
	const { attachment } = await makeFileResource();
	for (const expected of [new Date(), null]) {
		await expect(
			db.attachment.update(
				{ id: attachment.id },
				{ filename: "z.txt" },
				at(expected),
			),
		).rejects.toBeInstanceOf(InvalidData);
		await expect(
			db.attachment.delete({ id: attachment.id }, at(expected)),
		).rejects.toBeInstanceOf(InvalidData);
	}
	expect(await prisma.attachment.count({ where: { id: attachment.id } })).toBe(
		1,
	);
});

test("attachment.update to the same name changes nothing, so the resource keeps its version", async () => {
	const { resource, attachment } = await makeFileResource();
	await db.attachment.update(
		{ id: attachment.id },
		{ filename: "a.txt" },
		FULL_ACCESS,
	);
	const after = await db.resource.findOne({ id: resource.id }, FULL_ACCESS);
	expect(after?.updatedAt).toEqual(resource.updatedAt);
});

test("attachment.delete of a resource's current file bumps the resource", async () => {
	const { resource, attachment } = await makeFileResource();
	await db.attachment.delete({ id: attachment.id }, FULL_ACCESS);
	const after = await db.resource.findOne({ id: resource.id }, FULL_ACCESS);
	expect(after?.updatedAt.getTime()).toBeGreaterThan(
		resource.updatedAt.getTime(),
	);
});

test("replacing a resource's file through resource.update bumps it once", async () => {
	const { resource } = await makeFileResource();
	const out = await db.resource.update(
		{ id: resource.id },
		{ data: { type: "FILE", filename: "c.txt", buffer: Buffer.from(uniq()) } },
		at(resource.updatedAt),
	);
	const stored = await db.resource.findOne({ id: resource.id }, FULL_ACCESS);
	expect(out.updatedAt).toEqual(stored?.updatedAt);
	await db.resource.delete({ id: resource.id }, at(out.updatedAt));
});
