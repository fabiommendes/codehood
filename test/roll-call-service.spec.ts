import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { InvalidData, NotAllowed } from "@/core/error";
import type { CalendarEventId, CourseId, RollCallId } from "@/core/schemas";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { codeAt } from "@/services/roll-call-code";

const FIFTEEN_MIN = 15 * 60_000;
const DAY = 24 * 60 * 60_000;

// A random suffix, not an incrementing counter: sibling spec files share one
// test database in one run. Prefixed "rc-" so it never collides with theirs.
function tag(prefix: string): string {
	return `rc-${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

async function makeUser(role: "ADMIN" | "INSTRUCTOR" | "STUDENT") {
	const username = tag(role.toLowerCase());
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

async function makeCourse(instructorUsername: string) {
	const disciplineSlug = tag("disc");
	await db.discipline.create(
		{ slug: disciplineSlug, name: disciplineSlug },
		FULL_ACCESS,
	);
	return db.course.create(
		{
			discipline: disciplineSlug,
			instructor: instructorUsername,
			edition: await ensureEdition(),
			// A Monday, so a MONDAY slot's week 0 lands on the course's start.
			startAt: new Date("2026-01-05T12:00:00Z"),
			endAt: new Date("2026-05-01"),
		},
		FULL_ACCESS,
	);
}

async function makeSlot(courseId: CourseId) {
	return db.timeSlot.create(
		{
			course: courseId,
			slug: "mon",
			day: "MONDAY",
			start: { hour: 14, minute: 0 },
			duration: { hours: 2 },
		},
		FULL_ACCESS,
	);
}

type User = Awaited<ReturnType<typeof makeUser>>;
type Ctx = Awaited<ReturnType<typeof setup>>;

/** A course with its instructor and one `mon` time slot. */
async function setup() {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const slot = await makeSlot(course.id);
	return { instructor, course, slot, opts: { actor: instructor } };
}

function makeEvent(
	ctx: Ctx,
	week: number,
	kind: "REGULAR" | "HOLIDAY" | "CANCELLED" = "REGULAR",
) {
	return db.calendarEvent.create(
		{
			course: ctx.course.id,
			timeSlot: ctx.slot.id,
			week,
			title: `Class ${week}`,
			kind,
			rev: tag("h"),
		},
		FULL_ACCESS,
	);
}

async function enroll(
	course: { id: CourseId },
	user: User,
	status: "ACTIVE" | "DROPPED" = "ACTIVE",
) {
	await db.enrollment.create(
		{ course: course.id, username: user.username },
		FULL_ACCESS,
	);
	if (status === "DROPPED") {
		await prisma.enrollment.update({
			where: {
				username_courseId: { username: user.username, courseId: course.id },
			},
			data: { status },
		});
	}
}

async function enrollStudent(course: { id: CourseId }) {
	const student = await makeUser("STUDENT");
	await enroll(course, student);
	return student;
}

function setEnrolledAt(course: { id: CourseId }, user: User, date: Date) {
	return prisma.enrollment.update({
		where: {
			username_courseId: { username: user.username, courseId: course.id },
		},
		data: { createdAt: date },
	});
}

/** Inserts a roll call row directly, so the test does not depend on `create`. */
function seedRollCall(
	eventId: CalendarEventId,
	extra: { closesAt?: Date; actsAsInvite?: boolean; secret?: string } = {},
) {
	return prisma.rollCall.create({
		data: {
			eventId,
			secret: extra.secret ?? tag("secret"),
			actsAsInvite: extra.actsAsInvite ?? false,
			closesAt: extra.closesAt ?? new Date(Date.now() + FIFTEEN_MIN),
		},
	});
}

function seedAttendance(
	rollCall: { id: number },
	user: User,
	extra: {
		source?: "CODE" | "MANUAL";
		deviceHash?: string | null;
		note?: string | null;
	} = {},
) {
	return prisma.attendance.create({
		data: {
			rollCallId: rollCall.id,
			username: user.username,
			source: extra.source ?? "CODE",
			deviceHash: extra.deviceHash ?? null,
			note: extra.note ?? null,
		},
	});
}

function pk(rollCall: { id: number }) {
	return { id: rollCall.id as RollCallId };
}

function attendanceRow(rollCall: { id: number }, user: User) {
	return prisma.attendance.findUnique({
		where: {
			rollCallId_username: { rollCallId: rollCall.id, username: user.username },
		},
	});
}

function countRollCalls(eventId: number) {
	return prisma.rollCall.count({ where: { eventId } });
}

/** A roll call of week 1 where A is present by code, B is absent, C is manual. */
async function mergeFixture() {
	const ctx = await setup();
	const [a, b, c] = [
		await enrollStudent(ctx.course),
		await enrollStudent(ctx.course),
		await enrollStudent(ctx.course),
	];
	const event = await makeEvent(ctx, 1);
	const rollCall = await seedRollCall(event.id);
	await seedAttendance(rollCall, a, { deviceHash: "hash-a" });
	await seedAttendance(rollCall, c, { source: "MANUAL", note: "x" });
	return { ...ctx, a, b, c, event, rollCall };
}

//
// R1: eligible events
//

test("T3-01", async () => {
	const ctx = await setup();
	const event = await makeEvent(ctx, 1);

	const before = Date.now();
	const created = await db.rollCall.create(
		{ event: { id: event.id } },
		ctx.opts,
	);
	const after = Date.now();

	expect(created.attendances).toEqual({});
	expect(created.actsAsInvite).toBe(false);
	expect(created.closesAt.getTime()).toBeGreaterThanOrEqual(
		before + FIFTEEN_MIN,
	);
	expect(created.closesAt.getTime()).toBeLessThanOrEqual(after + FIFTEEN_MIN);
});

test("T3-02", async () => {
	const ctx = await setup();
	for (const [week, kind] of [
		[1, "HOLIDAY"],
		[2, "CANCELLED"],
	] as const) {
		const event = await makeEvent(ctx, week, kind);

		await expect(
			db.rollCall.create({ event: { id: event.id } }, ctx.opts),
		).rejects.toBeInstanceOf(InvalidData);
		expect(await countRollCalls(event.id)).toBe(0);
	}
});

test("T3-03", async () => {
	const ctx = await setup();
	const event = await makeEvent(ctx, 1);
	await db.rollCall.create({ event: { id: event.id } }, ctx.opts);

	await expect(
		db.rollCall.create({ event: { id: event.id } }, ctx.opts),
	).rejects.toThrow();
	expect(await countRollCalls(event.id)).toBe(1);
});

//
// R2: open and close
//

test("T3-04", async () => {
	const ctx = await setup();
	const student = await enrollStudent(ctx.course);
	const event = await makeEvent(ctx, 1);
	const rollCall = await seedRollCall(event.id);
	await seedAttendance(rollCall, student);

	const beforeClose = Date.now();
	await db.rollCall.close(pk(rollCall), ctx.opts);
	const afterClose = Date.now();
	const closed = await prisma.rollCall.findUniqueOrThrow({
		where: { id: rollCall.id },
	});
	expect(closed.closesAt.getTime()).toBeLessThanOrEqual(afterClose);
	expect(closed.closesAt.getTime()).toBeGreaterThanOrEqual(beforeClose);

	const before = Date.now();
	const reopened = await db.rollCall.open(pk(rollCall), ctx.opts);
	const after = Date.now();
	expect(reopened.id).toBe(rollCall.id);
	expect(reopened.closesAt.getTime()).toBeGreaterThanOrEqual(
		before + FIFTEEN_MIN,
	);
	expect(reopened.closesAt.getTime()).toBeLessThanOrEqual(after + FIFTEEN_MIN);
	expect(Object.keys(reopened.attendances)).toEqual([student.username]);
	expect(await countRollCalls(event.id)).toBe(1);
});

test("T3-05", async () => {
	const ctx = await setup();
	const event = await makeEvent(ctx, 1);
	const rollCall = await seedRollCall(event.id, {
		closesAt: new Date(Date.now() + 5 * 60_000),
	});

	const before = Date.now();
	const reopened = await db.rollCall.open(pk(rollCall), ctx.opts);
	const after = Date.now();

	expect(reopened.closesAt.getTime()).toBeGreaterThanOrEqual(
		before + FIFTEEN_MIN,
	);
	expect(reopened.closesAt.getTime()).toBeLessThanOrEqual(after + FIFTEEN_MIN);
});

//
// R3/R21: currentCode
//

test("T3-06", async () => {
	const ctx = await setup();
	const event = await makeEvent(ctx, 1);
	const rollCall = await seedRollCall(event.id, { secret: "test-secret" });

	const before = new Date();
	const current = await db.rollCall.currentCode(pk(rollCall), ctx.opts);
	const after = new Date();

	expect([
		codeAt("test-secret", before).code,
		codeAt("test-secret", after).code,
	]).toContain(current.code);
});

//
// R15: merge semantics
//

test("T3-07", async () => {
	const f = await mergeFixture();
	const rowA = await attendanceRow(f.rollCall, f.a);
	const rowC = await attendanceRow(f.rollCall, f.c);

	await db.rollCall.update(
		pk(f.rollCall),
		{ attendances: { [f.b.username]: {} } },
		f.opts,
	);

	expect(await attendanceRow(f.rollCall, f.b)).toMatchObject({
		source: "MANUAL",
		note: null,
	});
	expect(await attendanceRow(f.rollCall, f.a)).toEqual(rowA);
	expect(await attendanceRow(f.rollCall, f.c)).toEqual(rowC);
});

test("T3-08", async () => {
	const f = await mergeFixture();
	const rowC = await attendanceRow(f.rollCall, f.c);

	await db.rollCall.update(
		pk(f.rollCall),
		{ attendances: { [f.a.username]: null } },
		f.opts,
	);

	expect(await attendanceRow(f.rollCall, f.a)).toBeNull();
	expect(await attendanceRow(f.rollCall, f.b)).toBeNull();
	expect(await attendanceRow(f.rollCall, f.c)).toEqual(rowC);
});

test("T3-09", async () => {
	const f = await mergeFixture();
	const rowA = await attendanceRow(f.rollCall, f.a);

	await db.rollCall.update(
		pk(f.rollCall),
		{ attendances: { [f.a.username]: { note: "atrasou" } } },
		f.opts,
	);

	const after = await attendanceRow(f.rollCall, f.a);
	expect(after).toMatchObject({
		source: "CODE",
		note: "atrasou",
		deviceHash: "hash-a",
	});
	expect(after?.createdAt).toEqual(rowA?.createdAt);
});

test("T3-10", async () => {
	const f = await mergeFixture();

	await db.rollCall.update(
		pk(f.rollCall),
		{ attendances: { [f.c.username]: {} } },
		f.opts,
	);
	expect((await attendanceRow(f.rollCall, f.c))?.note).toBe("x");

	await db.rollCall.update(
		pk(f.rollCall),
		{ attendances: { [f.c.username]: { note: null } } },
		f.opts,
	);
	expect((await attendanceRow(f.rollCall, f.c))?.note).toBeNull();
});

test("T3-11", async () => {
	const f = await mergeFixture();
	const rowA = await attendanceRow(f.rollCall, f.a);
	const rowC = await attendanceRow(f.rollCall, f.c);

	const updated = await db.rollCall.update(
		pk(f.rollCall),
		{ actsAsInvite: true },
		f.opts,
	);

	expect(updated.actsAsInvite).toBe(true);
	expect(Object.keys(updated.attendances).sort()).toEqual(
		[f.a.username, f.c.username].sort(),
	);
	expect(await attendanceRow(f.rollCall, f.a)).toEqual(rowA);
	expect(await attendanceRow(f.rollCall, f.c)).toEqual(rowC);
});

test("T3-12", async () => {
	const f = await mergeFixture();
	const outsider = await makeUser("STUDENT");

	await expect(
		db.rollCall.update(
			pk(f.rollCall),
			{ attendances: { [f.b.username]: {}, [outsider.username]: {} } },
			f.opts,
		),
	).rejects.toBeInstanceOf(InvalidData);

	expect(await attendanceRow(f.rollCall, f.b)).toBeNull();
});

//
// R18: manual attendance
//

test("T3-13", async () => {
	const f = await mergeFixture();
	const stranger = await makeUser("STUDENT");

	for (const user of [stranger, f.instructor]) {
		await expect(
			db.rollCall.update(
				pk(f.rollCall),
				{ attendances: { [user.username]: {} } },
				f.opts,
			),
		).rejects.toBeInstanceOf(InvalidData);
		expect(await attendanceRow(f.rollCall, user)).toBeNull();
	}
});

test("T3-14", async () => {
	const f = await mergeFixture();
	const dropped = await makeUser("STUDENT");
	await enroll(f.course, dropped, "DROPPED");

	await db.rollCall.update(
		pk(f.rollCall),
		{ attendances: { [dropped.username]: {} } },
		f.opts,
	);

	expect(await attendanceRow(f.rollCall, dropped)).toMatchObject({
		source: "MANUAL",
	});
});

//
// R9: sharedWith
//

test("T3-15", async () => {
	const ctx = await setup();
	const [a, b, e, m1, m2] = [
		await enrollStudent(ctx.course),
		await enrollStudent(ctx.course),
		await enrollStudent(ctx.course),
		await enrollStudent(ctx.course),
		await enrollStudent(ctx.course),
	];
	const event = await makeEvent(ctx, 1);
	const rollCall = await seedRollCall(event.id);
	await seedAttendance(rollCall, a, { deviceHash: "h1" });
	await seedAttendance(rollCall, b, { deviceHash: "h1" });
	await seedAttendance(rollCall, e, { deviceHash: "h2" });
	await seedAttendance(rollCall, m1, { source: "MANUAL" });
	await seedAttendance(rollCall, m2, { source: "MANUAL" });

	const found = await db.rollCall.findOne(pk(rollCall), ctx.opts);

	const shared = (user: User) => found?.attendances[user.username]?.sharedWith;
	expect(shared(a)).toEqual([b.username]);
	expect(shared(b)).toEqual([a.username]);
	expect(shared(e)).toEqual([]);
	expect(shared(m1)).toEqual([]);
	expect(shared(m2)).toEqual([]);
});

//
// R24: permissions
//

test("T3-16", async () => {
	const f = await mergeFixture();
	const freeEvent = await makeEvent(f, 2);
	const opts = { actor: f.a };

	await expect(
		db.rollCall.create({ event: { id: freeEvent.id } }, opts),
	).rejects.toBeInstanceOf(NotAllowed);
	await expect(db.rollCall.open(pk(f.rollCall), opts)).rejects.toBeInstanceOf(
		NotAllowed,
	);
	await expect(db.rollCall.close(pk(f.rollCall), opts)).rejects.toBeInstanceOf(
		NotAllowed,
	);
	await expect(
		db.rollCall.currentCode(pk(f.rollCall), opts),
	).rejects.toBeInstanceOf(NotAllowed);
	await expect(
		db.rollCall.update(pk(f.rollCall), { actsAsInvite: true }, opts),
	).rejects.toBeInstanceOf(NotAllowed);
	await expect(db.rollCall.delete(pk(f.rollCall), opts)).rejects.toBeInstanceOf(
		NotAllowed,
	);

	expect(await countRollCalls(freeEvent.id)).toBe(0);
	expect(await countRollCalls(f.event.id)).toBe(1);
});

test("T3-17", async () => {
	const f = await mergeFixture();
	// A and B share a browser, so a leak of `sharedWith` would show.
	await seedAttendance(f.rollCall, f.b, { deviceHash: "hash-a" });
	const outsider = await enrollStudent(f.course);

	const one = await db.rollCall.findOne(pk(f.rollCall), { actor: f.a });
	expect(Object.keys(one?.attendances ?? {})).toEqual([f.a.username]);
	expect(one?.attendances[f.a.username]?.sharedWith).toEqual([]);

	const many = await db.rollCall.findMany(
		{ course: f.course.id },
		{ actor: f.a },
	);
	expect(many).toHaveLength(1);
	expect(Object.keys(many[0]?.attendances ?? {})).toEqual([f.a.username]);
	expect(many[0]?.attendances[f.a.username]?.sharedWith).toEqual([]);

	const absent = await db.rollCall.findOne(pk(f.rollCall), { actor: outsider });
	expect(absent?.attendances).toEqual({});
});

test("T3-18", async () => {
	const f = await mergeFixture();
	const other = { actor: await makeUser("INSTRUCTOR") };

	const expected = await db.calendarEvent
		.findOne({ id: f.event.id }, other)
		.catch((error: unknown) => error);
	expect(expected).toBeInstanceOf(NotAllowed);

	for (const attempt of [
		db.rollCall.findOne(pk(f.rollCall), other),
		db.rollCall.open(pk(f.rollCall), other),
	]) {
		const error = await attempt.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(NotAllowed);
		expect((error as NotAllowed).status).toBe((expected as NotAllowed).status);
	}
});

test("T3-19", async () => {
	const ctx = await setup();
	const admin = { actor: await makeUser("ADMIN") };
	const event = await makeEvent(ctx, 1);

	const created = await db.rollCall.create({ event: { id: event.id } }, admin);
	const updated = await db.rollCall.update(
		{ id: created.id },
		{ actsAsInvite: true },
		admin,
	);

	expect(updated.actsAsInvite).toBe(true);
});

//
// R13: deletion lock
//

test("T3-20", async () => {
	const f = await mergeFixture();

	const error = await db.calendarEvent
		.delete({ id: f.event.id }, f.opts)
		.catch((e: unknown) => e);

	expect(error).toBeInstanceOf(NotAllowed);
	expect((error as NotAllowed).status).toBe(409);
	expect(await prisma.calendarEvent.count({ where: { id: f.event.id } })).toBe(
		1,
	);
});

test("T3-21", async () => {
	const f = await mergeFixture();

	await db.rollCall.delete(pk(f.rollCall), f.opts);
	await db.calendarEvent.delete({ id: f.event.id }, f.opts);

	expect(await prisma.calendarEvent.count({ where: { id: f.event.id } })).toBe(
		0,
	);
	expect(await countRollCalls(f.event.id)).toBe(0);
	expect(
		await prisma.attendance.count({ where: { rollCallId: f.rollCall.id } }),
	).toBe(0);
});

test("T3-22", async () => {
	const f = await mergeFixture();

	await db.course.delete({ id: f.course.id }, f.opts);

	expect(await prisma.rollCall.count({ where: { id: f.rollCall.id } })).toBe(0);
	expect(
		await prisma.attendance.count({ where: { rollCallId: f.rollCall.id } }),
	).toBe(0);
});

//
// R19/R20: courseAttendance
//

/**
 * Weeks 1, 2 and 3 have a roll call (created in the order 3, 1, 2), week 4
 * has none. A is enrolled before week 1 and present in 1 and 3. B is enrolled
 * between weeks 1 and 2 and present in 2. D is DROPPED and present in 1. F is
 * enrolled after week 3 started and present in 3.
 */
async function reportFixture() {
	const ctx = await setup();
	const e3 = await makeEvent(ctx, 3);
	const e1 = await makeEvent(ctx, 1);
	const e2 = await makeEvent(ctx, 2);
	await makeEvent(ctx, 4);
	const [rc3, rc1, rc2] = [
		await seedRollCall(e3.id),
		await seedRollCall(e1.id),
		await seedRollCall(e2.id),
	];

	const [a, b, d, f] = [
		await makeUser("STUDENT"),
		await makeUser("STUDENT"),
		await makeUser("STUDENT"),
		await makeUser("STUDENT"),
	];
	await enroll(ctx.course, a);
	await enroll(ctx.course, b);
	await enroll(ctx.course, d, "DROPPED");
	await enroll(ctx.course, f);
	await setEnrolledAt(ctx.course, a, new Date(e1.startAt.getTime() - DAY));
	await setEnrolledAt(ctx.course, b, new Date(e1.startAt.getTime() + DAY));
	await setEnrolledAt(ctx.course, d, new Date(e1.startAt.getTime() - DAY));
	await setEnrolledAt(
		ctx.course,
		f,
		new Date(e3.startAt.getTime() + 60 * 60_000),
	);

	await seedAttendance(rc1, a);
	await seedAttendance(rc3, a);
	await seedAttendance(rc2, b);
	await seedAttendance(rc1, d);
	await seedAttendance(rc3, f);
	return { ...ctx, a, b, d, f };
}

test("T3-23", async () => {
	const f = await reportFixture();

	const report = await db.rollCall.courseAttendance(f.course.id, f.opts);

	expect(report.events.map((e) => e.week)).toEqual([1, 2, 3]);
	expect(report.events.map((e) => e.timeSlot)).toEqual(["mon", "mon", "mon"]);
	expect(report.events.map((e) => e.title)).toEqual([
		"Class 1",
		"Class 2",
		"Class 3",
	]);
});

test("T3-24", async () => {
	const f = await reportFixture();

	const report = await db.rollCall.courseAttendance(f.course.id, f.opts);

	const row = (user: User) =>
		report.students.find((s) => s.username === user.username);
	expect(row(f.a)).toMatchObject({
		cells: { "1/mon": "present", "2/mon": "absent", "3/mon": "present" },
		present: 2,
		total: 3,
	});
	expect(row(f.b)).toMatchObject({
		cells: {
			"1/mon": "before-enrollment",
			"2/mon": "present",
			"3/mon": "absent",
		},
		present: 1,
		total: 3,
	});
	expect(row(f.d)).toMatchObject({ status: "DROPPED" });
	expect(row(f.d)?.cells["1/mon"]).toBe("present");
});

test("T3-25", async () => {
	const f = await reportFixture();

	const report = await db.rollCall.courseAttendance(f.course.id, f.opts);

	const row = report.students.find((s) => s.username === f.f.username);
	expect(row?.cells["3/mon"]).toBe("present");
	expect(row?.present).toBe(1);
	expect(row?.total).toBe(3);
});

test("T3-26", async () => {
	const f = await reportFixture();

	const report = await db.rollCall.courseAttendance(f.course.id, {
		actor: f.a,
	});

	expect(report.students.map((s) => s.username)).toEqual([f.a.username]);
	expect(report.events.map((e) => e.week)).toEqual([1, 2, 3]);
});
