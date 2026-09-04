import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/core/actor";
import { prisma } from "@/db/client";
import { calendarEventService } from "@/db/services/calendar-event.service";
import { courseService } from "@/db/services/course.service";
import { disciplineService } from "@/db/services/discipline.service";
import { editionService } from "@/db/services/edition.service";
import { timeSlotService } from "@/db/services/time-slot.service";
import { userService } from "@/db/services/user.service";
import { examForEvent, relinkExam } from "@/db/util.exam-link";
import { endOf } from "@/utils/schedule-time";

const MIN = 60_000;

// Random suffix, not an incrementing counter: shared test database across
// spec files. Prefixed "cal-" so it never collides with another file's tag().
function tag(prefix: string): string {
	return `cal-${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

async function makeUser(role: "ADMIN" | "INSTRUCTOR" | "STUDENT") {
	const username = tag(role.toLowerCase());
	return userService.create(
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
	if (!(await editionService.findOne({ slug }))) {
		await editionService.create(
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
	await disciplineService.create(
		{ slug: disciplineSlug, name: disciplineSlug },
		FULL_ACCESS,
	);
	const editionSlug = await ensureEdition();
	return courseService.create(
		{
			disciplineSlug,
			instructorUsername,
			editionSlug,
			startAt: new Date("2026-01-01"),
			endAt: new Date("2026-05-01"),
		},
		FULL_ACCESS,
	);
}

interface SlotSpec {
	day: "MONDAY" | "TUESDAY";
	startMin: number;
	durationMin: number;
}

async function makeSlot(courseId: number, spec: SlotSpec, slug = tag("slot")) {
	return timeSlotService.create(
		{
			courseId,
			slug,
			day: spec.day,
			startMin: spec.startMin,
			durationMin: spec.durationMin,
		},
		FULL_ACCESS,
	);
}

async function makeEvent(
	courseId: number,
	timeSlotId: number,
	date: string,
	opts: { startMin?: number; durationMin?: number; week?: number } = {},
) {
	return calendarEventService.create(
		{
			courseId,
			timeSlotId,
			slug: tag("evt"),
			date,
			startMin: opts.startMin,
			durationMin: opts.durationMin,
			week: opts.week ?? 1,
			title: "Meeting",
			contentHash: tag("h"),
		},
		FULL_ACCESS,
	);
}

async function makeExam(
	courseId: number,
	authorId: number,
	fields: {
		scheduledAt: Date | null;
		durationMs?: number | null;
		extraTimeMs?: number;
	},
) {
	return prisma.exam.create({
		data: {
			slug: tag("exam"),
			status: "SCHEDULED",
			courseId,
			title: "Exam",
			authorId,
			scheduledAt: fields.scheduledAt,
			durationMs: fields.durationMs ?? null,
			extraTimeMs: fields.extraTimeMs ?? 0,
		},
	});
}

async function reload(eventId: number) {
	return calendarEventService.findOne({ id: eventId }, FULL_ACCESS);
}

test("an exam starting inside, one starting before and ending inside, and one spanning entirely all match", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const slot = await makeSlot(course.id, {
		day: "MONDAY",
		startMin: 840,
		durationMin: 120,
	});

	const evtInside = await makeEvent(course.id, slot.id, "2026-01-05");
	const examInside = await makeExam(course.id, instructor.id, {
		scheduledAt: new Date(evtInside.startAt.getTime() + 60 * MIN),
		durationMs: 30 * MIN,
	});
	expect(await examForEvent(prisma, evtInside)).toBe(examInside.id);

	const evtStartsBefore = await makeEvent(course.id, slot.id, "2026-01-12", {
		week: 2,
	});
	const examStartsBefore = await makeExam(course.id, instructor.id, {
		scheduledAt: new Date(evtStartsBefore.startAt.getTime() - 60 * MIN),
		durationMs: 90 * MIN, // ends 30 min into the event
	});
	expect(await examForEvent(prisma, evtStartsBefore)).toBe(examStartsBefore.id);

	const evtSpanned = await makeEvent(course.id, slot.id, "2026-01-19", {
		week: 3,
	});
	const examSpanning = await makeExam(course.id, instructor.id, {
		scheduledAt: new Date(evtSpanned.startAt.getTime() - 60 * MIN),
		durationMs: 240 * MIN, // spans well past the event's end
	});
	expect(await examForEvent(prisma, evtSpanned)).toBe(examSpanning.id);
});

test("adjacency is not overlap, at either edge", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const slot = await makeSlot(course.id, {
		day: "MONDAY",
		startMin: 840,
		durationMin: 120,
	});

	const evtA = await makeEvent(course.id, slot.id, "2026-01-05");
	const examStartsAtEnd = await makeExam(course.id, instructor.id, {
		scheduledAt: endOf(evtA.startAt, evtA.durationMin),
		durationMs: 30 * MIN,
	});
	expect(await examForEvent(prisma, evtA)).not.toBe(examStartsAtEnd.id);
	expect(await examForEvent(prisma, evtA)).toBeNull();

	const evtB = await makeEvent(course.id, slot.id, "2026-01-12", { week: 2 });
	await makeExam(course.id, instructor.id, {
		scheduledAt: new Date(evtB.startAt.getTime() - 30 * MIN),
		durationMs: 30 * MIN, // ends exactly at evtB.startAt
	});
	expect(await examForEvent(prisma, evtB)).toBeNull();
});

test("extraTimeMs extends the match: one event initially, two once extra time crosses the boundary, with relink firing on that write", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const slotA = await makeSlot(course.id, {
		day: "MONDAY",
		startMin: 540,
		durationMin: 60,
	}); // 09:00-10:00
	const slotB = await makeSlot(course.id, {
		day: "MONDAY",
		startMin: 600,
		durationMin: 60,
	}); // 10:00-11:00

	const evtA = await makeEvent(course.id, slotA.id, "2026-01-05");
	const evtB = await makeEvent(course.id, slotB.id, "2026-01-05", { week: 1 });

	const exam = await makeExam(course.id, instructor.id, {
		scheduledAt: evtA.startAt,
		durationMs: 60 * MIN, // 09:00-10:00: matches evtA only, adjacent to evtB
	});
	await relinkExam(prisma, exam.id);
	expect((await reload(evtA.id))?.exam?.id).toBe(exam.id);
	expect((await reload(evtB.id))?.exam).toBeNull();

	await prisma.exam.update({
		where: { id: exam.id },
		data: { extraTimeMs: 30 * MIN },
	});
	await relinkExam(prisma, exam.id);
	expect((await reload(evtA.id))?.exam?.id).toBe(exam.id);
	expect((await reload(evtB.id))?.exam?.id).toBe(exam.id);
});

test("a null durationMs matches the containing instant; a null scheduledAt matches nothing and clears the link it held", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const slot = await makeSlot(course.id, {
		day: "MONDAY",
		startMin: 840,
		durationMin: 120,
	});
	const evt = await makeEvent(course.id, slot.id, "2026-01-05");

	const exam = await makeExam(course.id, instructor.id, {
		scheduledAt: new Date(evt.startAt.getTime() + 30 * MIN),
		durationMs: null,
	});
	await relinkExam(prisma, exam.id);
	expect((await reload(evt.id))?.exam?.id).toBe(exam.id);

	await prisma.exam.update({
		where: { id: exam.id },
		data: { scheduledAt: null },
	});
	await relinkExam(prisma, exam.id);
	expect((await reload(evt.id))?.exam).toBeNull();
});

test("a three-hour exam over two consecutive meetings links from both events", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const slotA = await makeSlot(course.id, {
		day: "MONDAY",
		startMin: 540,
		durationMin: 90,
	}); // 09:00-10:30
	const slotB = await makeSlot(course.id, {
		day: "MONDAY",
		startMin: 630,
		durationMin: 90,
	}); // 10:30-12:00

	const evtA = await makeEvent(course.id, slotA.id, "2026-01-05");
	const evtB = await makeEvent(course.id, slotB.id, "2026-01-05", { week: 1 });

	const exam = await makeExam(course.id, instructor.id, {
		scheduledAt: evtA.startAt,
		durationMs: 180 * MIN, // 09:00-12:00, covering both meetings exactly
	});
	await relinkExam(prisma, exam.id);

	expect((await reload(evtA.id))?.exam?.id).toBe(exam.id);
	expect((await reload(evtB.id))?.exam?.id).toBe(exam.id);
});

test("two exams inside one event: the earlier scheduledAt wins, and a tie at equal instants falls to the lower id", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const slot = await makeSlot(course.id, {
		day: "MONDAY",
		startMin: 840,
		durationMin: 120,
	});
	const evt = await makeEvent(course.id, slot.id, "2026-01-05");

	const earlier = await makeExam(course.id, instructor.id, {
		scheduledAt: new Date(evt.startAt.getTime() + 10 * MIN),
		durationMs: 10 * MIN,
	});
	await makeExam(course.id, instructor.id, {
		scheduledAt: new Date(evt.startAt.getTime() + 30 * MIN),
		durationMs: 10 * MIN,
	});
	expect(await examForEvent(prisma, evt)).toBe(earlier.id);

	// A tie at the same instant as `earlier`, created afterwards (higher id):
	// the lower id still wins.
	const tie = await makeExam(course.id, instructor.id, {
		scheduledAt: new Date(evt.startAt.getTime() + 10 * MIN),
		durationMs: 10 * MIN,
	});
	expect(tie.id).toBeGreaterThan(earlier.id);
	expect(await examForEvent(prisma, evt)).toBe(earlier.id);
});

test("update moving an event out of its exam's window clears the link; moving it back restores it", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const slot = await makeSlot(course.id, {
		day: "MONDAY",
		startMin: 840,
		durationMin: 120,
	});
	const evt = await makeEvent(course.id, slot.id, "2026-01-05");

	const exam = await makeExam(course.id, instructor.id, {
		scheduledAt: new Date(evt.startAt.getTime() + 30 * MIN),
		durationMs: 30 * MIN,
	});
	await relinkExam(prisma, exam.id);
	expect((await reload(evt.id))?.exam?.id).toBe(exam.id);

	const movedAway = await calendarEventService.update(
		{ id: evt.id },
		{ date: "2026-01-12" },
		{ actor: instructor },
	);
	expect(movedAway.exam).toBeNull();

	const movedBack = await calendarEventService.update(
		{ id: evt.id },
		{ date: "2026-01-05" },
		{ actor: instructor },
	);
	expect(movedBack.exam?.id).toBe(exam.id);
});

test("relinkExam hands a vacated event to a second overlapping exam rather than blanking it, and never touches contentHash", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const slot = await makeSlot(course.id, {
		day: "MONDAY",
		startMin: 840,
		durationMin: 120,
	});
	const evt = await makeEvent(course.id, slot.id, "2026-01-05");
	const originalHash = evt.contentHash;

	const winner = await makeExam(course.id, instructor.id, {
		scheduledAt: new Date(evt.startAt.getTime() + 10 * MIN),
		durationMs: 10 * MIN,
	});
	const runnerUp = await makeExam(course.id, instructor.id, {
		scheduledAt: new Date(evt.startAt.getTime() + 30 * MIN),
		durationMs: 10 * MIN,
	});
	await relinkExam(prisma, winner.id);
	await relinkExam(prisma, runnerUp.id);
	expect((await reload(evt.id))?.exam?.id).toBe(winner.id);

	// Move the winner far away: the event should now pick up the runner-up
	// rather than being left with no link.
	await prisma.exam.update({
		where: { id: winner.id },
		data: { scheduledAt: new Date("2030-01-01T00:00:00Z") },
	});
	await relinkExam(prisma, winner.id);

	const after = await reload(evt.id);
	expect(after?.exam?.id).toBe(runnerUp.id);
	expect(after?.contentHash).toBe(originalHash);
});

test("an exam window crossing midnight matches the meetings on both days", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const lateMonday = await makeSlot(course.id, {
		day: "MONDAY",
		startMin: 1380,
		durationMin: 30,
	}); // 23:00-23:30 template
	const earlyTuesday = await makeSlot(course.id, {
		day: "TUESDAY",
		startMin: 0,
		durationMin: 60,
	}); // 00:00-01:00

	// The event itself runs longer than its slot's template: 23:00 Monday to
	// 01:00 Tuesday, crossing midnight.
	const evtMonday = await makeEvent(course.id, lateMonday.id, "2026-01-05", {
		durationMin: 120,
	});
	const evtTuesday = await makeEvent(course.id, earlyTuesday.id, "2026-01-06", {
		week: 1,
	});

	const exam = await makeExam(course.id, instructor.id, {
		scheduledAt: new Date(evtMonday.startAt.getTime() + 30 * MIN), // 23:30 Monday
		durationMs: 120 * MIN, // ends 01:30 Tuesday
	});
	await relinkExam(prisma, exam.id);

	expect((await reload(evtMonday.id))?.exam?.id).toBe(exam.id);
	expect((await reload(evtTuesday.id))?.exam?.id).toBe(exam.id);
});

test("the two push orders converge: exam-then-event and event-then-exam leave the same link", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const slot = await makeSlot(course.id, {
		day: "MONDAY",
		startMin: 840,
		durationMin: 120,
	});

	// Order A: the exam lands first. Its relink finds no events yet; the
	// event's own create finds the exam when it arrives.
	const examFirst = await makeExam(course.id, instructor.id, {
		scheduledAt: new Date("2026-01-05T00:00:00Z"),
		durationMs: 240 * MIN,
	});
	await relinkExam(prisma, examFirst.id); // no-op: no events yet
	const evtA = await makeEvent(course.id, slot.id, "2026-01-05");
	// examFirst's window (00:00-04:00Z) doesn't necessarily hit evtA's local
	// hours, so link it directly at a matching instant instead — the point
	// under test is convergence, not this specific window.
	await prisma.exam.update({
		where: { id: examFirst.id },
		data: {
			scheduledAt: new Date(evtA.startAt.getTime() + 10 * MIN),
			durationMs: 10 * MIN,
		},
	});
	await relinkExam(prisma, examFirst.id);

	// Order B: the event lands first, with no exam to match. The exam then
	// arrives with the same relative window and pulls the link in via relink.
	const evtB = await makeEvent(course.id, slot.id, "2026-01-12", { week: 2 });
	expect((await reload(evtB.id))?.exam).toBeNull();
	const examSecond = await makeExam(course.id, instructor.id, {
		scheduledAt: new Date(evtB.startAt.getTime() + 10 * MIN),
		durationMs: 10 * MIN,
	});
	await relinkExam(prisma, examSecond.id);

	expect((await reload(evtA.id))?.exam?.id).toBe(examFirst.id);
	expect((await reload(evtB.id))?.exam?.id).toBe(examSecond.id);
});

test("an exam in another course is never matched, even at the same instant", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const courseA = await makeCourse(instructor.username);
	const courseB = await makeCourse(instructor.username);
	const slotA = await makeSlot(courseA.id, {
		day: "MONDAY",
		startMin: 840,
		durationMin: 120,
	});

	const evt = await makeEvent(courseA.id, slotA.id, "2026-01-05");
	await makeExam(courseB.id, instructor.id, {
		scheduledAt: evt.startAt,
		durationMs: evt.durationMin * MIN,
	});

	expect(await examForEvent(prisma, evt)).toBeNull();
});
