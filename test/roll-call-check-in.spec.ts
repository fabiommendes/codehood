import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { CheckInError } from "@/core/error";
import type { CalendarEventId, CourseId, RollCallId } from "@/core/schemas";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { codeAt } from "@/services/roll-call-code";

const MINUTE = 60_000;

// A random suffix, not an incrementing counter: sibling spec files share one
// test database in one run. Prefixed "rci-" so it never collides with theirs.
function tag(prefix: string): string {
	return `rci-${prefix}${Math.random().toString(36).slice(2, 10)}`;
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
			startAt: new Date("2026-01-05T12:00:00Z"),
			endAt: new Date("2026-05-01"),
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
	return { instructor, course, slot, opts: { actor: instructor } };
}

function makeEvent(ctx: Ctx, week: number) {
	return db.calendarEvent.create(
		{
			course: ctx.course.id,
			timeSlot: ctx.slot.id,
			week,
			title: `Class ${week}`,
			kind: "REGULAR",
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
			closesAt: extra.closesAt ?? new Date(Date.now() + 15 * MINUTE),
		},
	});
}

type SeededRollCall = Awaited<ReturnType<typeof seedRollCall>>;

/** A course with an open roll call, ready for check-ins. */
async function openRollCall(
	extra: { closesAt?: Date; actsAsInvite?: boolean; secret?: string } = {},
) {
	const ctx = await setup();
	const event = await makeEvent(ctx, 1);
	const rollCall = await seedRollCall(event.id, extra);
	return { ...ctx, event, rollCall };
}

/** The code on the instructor's screen at `at`. */
function codeOf(rollCall: SeededRollCall, at: Date = new Date()): string {
	return codeAt(rollCall.secret, at).code;
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

function countAttendances(rollCall: { id: number }) {
	return prisma.attendance.count({ where: { rollCallId: rollCall.id } });
}

function enrollmentRow(course: { id: CourseId }, user: User) {
	return prisma.enrollment.findUnique({
		where: {
			username_courseId: { username: user.username, courseId: course.id },
		},
	});
}

/** Asserts the promise rejects with a `CheckInError` of the given code. */
async function expectRefused(promise: Promise<unknown>, code: string) {
	const error = await promise.then(
		() => null,
		(e: unknown) => e,
	);
	expect(error).toBeInstanceOf(CheckInError);
	expect((error as CheckInError).code).toBe(code);
}

test("T4-01 enrolled student checks in: CODE row, joined null, event title and start", async () => {
	const f = await openRollCall();
	const student = await enrollStudent(f.course);

	const result = await db.rollCall.checkIn(
		{
			code: codeOf(f.rollCall),
			rollCallId: pk(f.rollCall).id,
			deviceId: tag("dev"),
		},
		{ actor: student },
	);

	expect(result.joined).toBeNull();
	expect(result.title).toBe(f.event.title);
	expect(result.startAt).toEqual(f.event.startAt);
	const row = await attendanceRow(f.rollCall, student);
	expect(row?.source).toBe("CODE");
	expect(row?.joined).toBeNull();
});

test("T4-02 code from 60 s ago is expired and writes nothing", async () => {
	const f = await openRollCall();
	const student = await enrollStudent(f.course);

	await expectRefused(
		db.rollCall.checkIn(
			{
				code: codeOf(f.rollCall, new Date(Date.now() - 60_000)),
				rollCallId: pk(f.rollCall).id,
				deviceId: tag("dev"),
			},
			{ actor: student },
		),
		"expired",
	);

	expect(await countAttendances(f.rollCall)).toBe(0);
});

test("T4-03 closed roll call refuses even the current code", async () => {
	const f = await openRollCall({ closesAt: new Date(Date.now() - 5_000) });
	const student = await enrollStudent(f.course);

	await expectRefused(
		db.rollCall.checkIn(
			{
				code: codeOf(f.rollCall),
				rollCallId: pk(f.rollCall).id,
				deviceId: tag("dev"),
			},
			{ actor: student },
		),
		"closed",
	);

	expect(await countAttendances(f.rollCall)).toBe(0);
});

test("T4-04 typed code without rollCallId finds the matching open roll call", async () => {
	const a = await openRollCall();
	const b = await openRollCall();
	const student = await enrollStudent(a.course);
	await enroll(b.course, student);

	await db.rollCall.checkIn(
		{ code: codeOf(b.rollCall), deviceId: tag("dev") },
		{ actor: student },
	);

	expect(await attendanceRow(b.rollCall, student)).not.toBeNull();
	expect(await attendanceRow(a.rollCall, student)).toBeNull();

	// Once the matching roll call is closed, its code matches nothing.
	await prisma.rollCall.update({
		where: { id: b.rollCall.id },
		data: { closesAt: new Date(Date.now() - 1_000) },
	});
	const other = await enrollStudent(b.course);
	await expectRefused(
		db.rollCall.checkIn(
			{ code: codeOf(b.rollCall), deviceId: tag("dev") },
			{ actor: other },
		),
		"invalid-code",
	);
});

test("T4-05 two open roll calls with the same secret: student of B is present in B", async () => {
	const secret = tag("shared");
	const a = await openRollCall({ secret });
	const b = await openRollCall({ secret });
	const student = await enrollStudent(b.course);

	await db.rollCall.checkIn(
		{ code: codeOf(b.rollCall), deviceId: tag("dev") },
		{ actor: student },
	);

	expect(await attendanceRow(b.rollCall, student)).not.toBeNull();
	expect(await countAttendances(a.rollCall)).toBe(0);
});

test("T4-06 dropped student is refused even with actsAsInvite, and stays dropped", async () => {
	const f = await openRollCall({ actsAsInvite: true });
	const student = await makeUser("STUDENT");
	await enroll(f.course, student, "DROPPED");

	await expectRefused(
		db.rollCall.checkIn(
			{
				code: codeOf(f.rollCall),
				rollCallId: pk(f.rollCall).id,
				deviceId: tag("dev"),
			},
			{ actor: student },
		),
		"dropped",
	);

	expect(await countAttendances(f.rollCall)).toBe(0);
	expect((await enrollmentRow(f.course, student))?.status).toBe("DROPPED");
});

test("T4-07 not enrolled and actsAsInvite off: refused, no row, no enrollment", async () => {
	const f = await openRollCall();
	const outsider = await makeUser("STUDENT");

	await expectRefused(
		db.rollCall.checkIn(
			{
				code: codeOf(f.rollCall),
				rollCallId: pk(f.rollCall).id,
				deviceId: tag("dev"),
			},
			{ actor: outsider },
		),
		"not-enrolled",
	);

	expect(await countAttendances(f.rollCall)).toBe(0);
	expect(await enrollmentRow(f.course, outsider)).toBeNull();
});

test("T4-08 course instructor and admin are not students", async () => {
	const f = await openRollCall({ actsAsInvite: true });
	const admin = await makeUser("ADMIN");

	for (const actor of [f.instructor, admin]) {
		await expectRefused(
			db.rollCall.checkIn(
				{
					code: codeOf(f.rollCall),
					rollCallId: pk(f.rollCall).id,
					deviceId: tag("dev"),
				},
				{ actor },
			),
			"not-student",
		);
	}

	expect(await countAttendances(f.rollCall)).toBe(0);
});

test("T4-09 actsAsInvite enrolls an existing user and records joined ENROLLMENT", async () => {
	const f = await openRollCall({ actsAsInvite: true });
	const newcomer = await makeUser("STUDENT");

	const result = await db.rollCall.checkIn(
		{
			code: codeOf(f.rollCall),
			rollCallId: pk(f.rollCall).id,
			deviceId: tag("dev"),
		},
		{ actor: newcomer },
	);

	expect(result.joined).toBe("ENROLLMENT");
	expect((await enrollmentRow(f.course, newcomer))?.status).toBe("ACTIVE");
	expect((await attendanceRow(f.rollCall, newcomer))?.joined).toBe(
		"ENROLLMENT",
	);
});

test("T4-10 already enrolled with actsAsInvite: joined stays null", async () => {
	const f = await openRollCall({ actsAsInvite: true });
	const student = await enrollStudent(f.course);

	const result = await db.rollCall.checkIn(
		{
			code: codeOf(f.rollCall),
			rollCallId: pk(f.rollCall).id,
			deviceId: tag("dev"),
		},
		{ actor: student },
	);

	expect(result.joined).toBeNull();
	expect((await attendanceRow(f.rollCall, student))?.joined).toBeNull();
});

test("T4-11 checkInClaim with accountCreated enrolls and records joined ACCOUNT; refused without actsAsInvite", async () => {
	const invite = await openRollCall({ actsAsInvite: true });
	const fresh = await makeUser("STUDENT");

	const result = await db.rollCall.checkInClaim(
		{
			rollCallId: pk(invite.rollCall).id,
			claimedAt: new Date(),
			deviceId: tag("dev"),
			accountCreated: true,
		},
		{ actor: fresh },
	);

	expect(result.joined).toBe("ACCOUNT");
	expect((await enrollmentRow(invite.course, fresh))?.status).toBe("ACTIVE");
	expect((await attendanceRow(invite.rollCall, fresh))?.joined).toBe("ACCOUNT");

	const closedDoor = await openRollCall();
	const other = await makeUser("STUDENT");
	await expectRefused(
		db.rollCall.checkInClaim(
			{
				rollCallId: pk(closedDoor.rollCall).id,
				claimedAt: new Date(),
				deviceId: tag("dev"),
				accountCreated: true,
			},
			{ actor: other },
		),
		"not-enrolled",
	);
	expect(await countAttendances(closedDoor.rollCall)).toBe(0);
});

test("T4-12 second check-in from another device keeps the first row", async () => {
	const f = await openRollCall();
	const student = await enrollStudent(f.course);
	const input = {
		code: codeOf(f.rollCall),
		rollCallId: pk(f.rollCall).id,
	};

	await db.rollCall.checkIn(
		{ ...input, deviceId: tag("first") },
		{ actor: student },
	);
	const first = await attendanceRow(f.rollCall, student);
	await db.rollCall.checkIn(
		{ ...input, deviceId: tag("second") },
		{ actor: student },
	);

	expect(await countAttendances(f.rollCall)).toBe(1);
	const second = await attendanceRow(f.rollCall, student);
	expect(first?.deviceHash).toBeTruthy();
	expect(second?.deviceHash).toBe(first?.deviceHash);
	expect(second?.createdAt).toEqual(first?.createdAt);
});

test("T4-13 student with a MANUAL entry and note keeps both after checking in", async () => {
	const f = await openRollCall();
	const student = await enrollStudent(f.course);
	await prisma.attendance.create({
		data: {
			rollCallId: f.rollCall.id,
			username: student.username,
			source: "MANUAL",
			note: "atestado",
		},
	});

	await db.rollCall.checkIn(
		{
			code: codeOf(f.rollCall),
			rollCallId: pk(f.rollCall).id,
			deviceId: tag("dev"),
		},
		{ actor: student },
	);

	const row = await attendanceRow(f.rollCall, student);
	expect(await countAttendances(f.rollCall)).toBe(1);
	expect(row?.source).toBe("MANUAL");
	expect(row?.note).toBe("atestado");
});

test("T4-14 repeating a check-in keeps joined ENROLLMENT", async () => {
	const f = await openRollCall({ actsAsInvite: true });
	const newcomer = await makeUser("STUDENT");
	const input = {
		code: codeOf(f.rollCall),
		rollCallId: pk(f.rollCall).id,
		deviceId: tag("dev"),
	};
	await db.rollCall.checkIn(input, { actor: newcomer });

	await db.rollCall.checkIn(input, { actor: newcomer });

	expect((await attendanceRow(f.rollCall, newcomer))?.joined).toBe(
		"ENROLLMENT",
	);
	expect(await countAttendances(f.rollCall)).toBe(1);
});

test("T4-15 same deviceId: equal hash that is not the raw id, visible in sharedWith", async () => {
	const f = await openRollCall();
	const [a, b] = [await enrollStudent(f.course), await enrollStudent(f.course)];
	const deviceId = tag("shared-dev");
	const input = {
		code: codeOf(f.rollCall),
		rollCallId: pk(f.rollCall).id,
		deviceId,
	};

	await db.rollCall.checkIn(input, { actor: a });
	await db.rollCall.checkIn(input, { actor: b });

	const rowA = await attendanceRow(f.rollCall, a);
	const rowB = await attendanceRow(f.rollCall, b);
	expect(rowA?.deviceHash).toBeTruthy();
	expect(rowA?.deviceHash).not.toBe(deviceId);
	expect(rowB?.deviceHash).toBe(rowA?.deviceHash);

	const seen = await db.rollCall.findOne(pk(f.rollCall), f.opts);
	expect(seen?.attendances[a.username]?.sharedWith).toEqual([b.username]);
	expect(seen?.attendances[b.username]?.sharedWith).toEqual([a.username]);
});

test("T4-18 checkInClaim honors a claim of 9 min even after the code expired and the roll call closed; 11 min is claim-expired", async () => {
	const f = await openRollCall({ closesAt: new Date(Date.now() - 5 * MINUTE) });
	const [fresh, late] = [
		await enrollStudent(f.course),
		await enrollStudent(f.course),
	];

	await db.rollCall.checkInClaim(
		{
			rollCallId: pk(f.rollCall).id,
			claimedAt: new Date(Date.now() - 9 * MINUTE),
			deviceId: tag("dev"),
			accountCreated: false,
		},
		{ actor: fresh },
	);
	expect(await attendanceRow(f.rollCall, fresh)).not.toBeNull();

	await expectRefused(
		db.rollCall.checkInClaim(
			{
				rollCallId: pk(f.rollCall).id,
				claimedAt: new Date(Date.now() - 11 * MINUTE),
				deviceId: tag("dev"),
				accountCreated: false,
			},
			{ actor: late },
		),
		"claim-expired",
	);
	expect(await attendanceRow(f.rollCall, late)).toBeNull();
});
