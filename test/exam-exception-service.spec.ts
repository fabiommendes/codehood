import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { InvalidData, NotAllowed, NotFound } from "@/core/error";
import { db, type schema } from "@/db";
import type { ExamExceptionCreate } from "@/db/services/exam-exception.service";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedUserFactory } from "@/fixtures/user.factory";
import { durationToMinutes } from "@/utils/schedule-time";

// Random suffix, not an incrementing counter: slugs would otherwise collide
// with the ones sibling spec files draw from the shared test database.
function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

const MINUTE = 60_000;

/// `minutes` from the real clock, negative for the past.
function fromNow(minutes: number): Date {
	return new Date(Date.now() + minutes * MINUTE);
}

async function ensureEdition(slug = "2094-1"): Promise<string> {
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

async function enroll(courseId: schema.CourseId) {
	const student = await persistedUserFactory.create({ role: "STUDENT" });
	await db.enrollment.create(
		{ course: courseId, username: student.username },
		FULL_ACCESS,
	);
	return student;
}

/// A course with an enrolled student and a 60 minute scheduled `EXAM`.
async function setup() {
	const instructor = await persistedUserFactory.create({ role: "INSTRUCTOR" });
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
		edition: await ensureEdition(),
	});
	const student = await enroll(course.id);
	return { course, instructor, student };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

type ExamKind = {
	type?: "QUIZ" | "EXAM" | "PRACTICE";
	timed?: boolean;
	slug?: string;
};

async function makeExam(
	ctx: Ctx,
	{ type = "EXAM", timed = true, slug = tag("exam-") }: ExamKind,
) {
	return persistedExamFactory.create({
		course: ctx.course.id,
		slug,
		type,
		status: "SCHEDULED",
		scheduledAt: fromNow(60),
		duration: timed ? { minutes: 60 } : undefined,
	});
}

/// Creates an exception on `exam` for the setup's student, as the system.
function createException(
	ctx: Ctx,
	exam: { slug: string },
	fields: Partial<ExamExceptionCreate>,
) {
	return db.examException.create(
		{
			course: ctx.course.id,
			exam: exam.slug,
			username: ctx.student.username,
			...fields,
		},
		FULL_ACCESS,
	);
}

/// The `InvalidData` a create is refused with, failing the test if it succeeds.
async function refusal(attempt: Promise<unknown>): Promise<InvalidData> {
	const error = await attempt.then(
		() => null,
		(e: unknown) => e,
	);
	expect(error).toBeInstanceOf(InvalidData);
	return error as InvalidData;
}

test("create: grants extra time on a timed exam, readable back", async () => {
	const ctx = await setup();
	const exam = await makeExam(ctx, {});
	const created = await createException(ctx, exam, {
		extraTime: { minutes: 30 },
		note: "atestado",
	});
	expect(created).toMatchObject({
		exam: exam.slug,
		username: ctx.student.username,
		scheduledAt: null,
		note: "atestado",
	});
	expect(created.extraTime && durationToMinutes(created.extraTime)).toBe(30);
	const found = await db.examException.findOne(
		{ course: ctx.course.id, exam: exam.slug, username: ctx.student.username },
		FULL_ACCESS,
	);
	expect(found?.extraTime && durationToMinutes(found.extraTime)).toBe(30);
});

test("create: a makeup date alone is accepted and stores no extra time", async () => {
	const ctx = await setup();
	const exam = await makeExam(ctx, { type: "QUIZ" });
	const makeup = fromNow(60 * 48);
	const created = await createException(ctx, exam, {
		extraTime: { minutes: 0 },
		scheduledAt: makeup,
	});
	expect(created.extraTime).toBeNull();
	expect(created.scheduledAt).toEqual(makeup);
});

test("create: a dropped student can still get an exception", async () => {
	const ctx = await setup();
	const exam = await makeExam(ctx, {});
	await db.enrollment.delete(
		{ course: ctx.course.id, username: ctx.student.username },
		FULL_ACCESS,
	);
	const created = await createException(ctx, exam, {
		extraTime: { minutes: 30 },
	});
	expect(created.username).toBe(ctx.student.username);
});

test("create: a student not enrolled in the course is refused", async () => {
	const ctx = await setup();
	const exam = await makeExam(ctx, {});
	const outsider = await persistedUserFactory.create({ role: "STUDENT" });
	const error = await refusal(
		createException(ctx, exam, {
			username: outsider.username,
			extraTime: { minutes: 30 },
		}),
	);
	expect(error.errors).toHaveProperty("username");
});

test("create: an exception granting nothing is refused", async () => {
	const ctx = await setup();
	const exam = await makeExam(ctx, {});
	await refusal(createException(ctx, exam, { extraTime: null }));
	await refusal(createException(ctx, exam, { extraTime: { minutes: 0 } }));
	await refusal(createException(ctx, exam, { extraTime: undefined }));
});

test("create: a makeup date on an exam without duration is refused", async () => {
	const ctx = await setup();
	const exam = await makeExam(ctx, { timed: false });
	const error = await refusal(
		createException(ctx, exam, { scheduledAt: fromNow(60 * 48) }),
	);
	expect(error.errors).toHaveProperty("scheduledAt");
});

test("create: extra time alone is accepted on an exam without duration", async () => {
	const ctx = await setup();
	const exam = await makeExam(ctx, { timed: false });
	const created = await createException(ctx, exam, {
		extraTime: { minutes: 15 },
	});
	expect(created.extraTime && durationToMinutes(created.extraTime)).toBe(15);
});

test("create: an exception on a PRACTICE exam is refused", async () => {
	const ctx = await setup();
	const exam = await makeExam(ctx, { type: "PRACTICE" });
	const error = await refusal(
		createException(ctx, exam, { extraTime: { minutes: 30 } }),
	);
	expect(error.errors).toHaveProperty("exam");
});

test("create: up to 24 hours of extra time is accepted", async () => {
	const ctx = await setup();
	const exam = await makeExam(ctx, {});
	const created = await createException(ctx, exam, {
		extraTime: { hours: 24 },
	});
	expect(created.extraTime && durationToMinutes(created.extraTime)).toBe(
		24 * 60,
	);
});

const tooLong: Array<[string, { hours?: number; minutes?: number }]> = [
	["one minute over 24 hours", { hours: 24, minutes: 1 }],
	["25 hours", { hours: 25 }],
	["1500 minutes", { minutes: 1500 }],
];

for (const [label, extraTime] of tooLong) {
	test(`create: extra time of ${label} is refused`, async () => {
		const ctx = await setup();
		const exam = await makeExam(ctx, {});
		const error = await refusal(createException(ctx, exam, { extraTime }));
		expect(error.errors).toHaveProperty("extraTime");
	});
}

test("create: a second exception for the same student and exam is refused", async () => {
	const ctx = await setup();
	const exam = await makeExam(ctx, {});
	await createException(ctx, exam, { extraTime: { minutes: 30 } });
	await refusal(createException(ctx, exam, { extraTime: { minutes: 45 } }));
});

test("create: the same student may have an exception on each of two exams", async () => {
	const ctx = await setup();
	const first = await makeExam(ctx, {});
	const second = await makeExam(ctx, {});
	await createException(ctx, first, { extraTime: { minutes: 30 } });
	const created = await createException(ctx, second, {
		extraTime: { minutes: 30 },
	});
	expect(created.exam).toBe(second.slug);
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/// Two exams (`a-...` sorts before `b-...`) with an exception each for the setup's student, plus one for a second student on the first exam.
async function withExceptions() {
	const ctx = await setup();
	const other = await enroll(ctx.course.id);
	const first = await makeExam(ctx, { slug: tag("a-") });
	const second = await makeExam(ctx, { slug: tag("b-") });
	await createException(ctx, first, {
		extraTime: { minutes: 30 },
		note: "atestado",
	});
	await createException(ctx, second, {
		extraTime: { minutes: 15 },
		note: "laudo",
	});
	await createException(ctx, first, {
		username: other.username,
		extraTime: { minutes: 45 },
		note: "outro",
	});
	return { ctx, other, first, second };
}

test("findOne: the course owner gets the whole row, note included", async () => {
	const { ctx, first } = await withExceptions();
	const found = await db.examException.findOne(
		{ course: ctx.course.id, exam: first.slug, username: ctx.student.username },
		{ actor: ctx.instructor },
	);
	expect(found).toMatchObject({
		username: ctx.student.username,
		note: "atestado",
	});
	expect(found?.extraTime && durationToMinutes(found.extraTime)).toBe(30);
});

test("findOne: the student reads their own exception without a note key", async () => {
	const { ctx, first } = await withExceptions();
	const found = await db.examException.findOne(
		{ course: ctx.course.id, exam: first.slug, username: ctx.student.username },
		{ actor: ctx.student },
	);
	expect(found).toMatchObject({
		username: ctx.student.username,
	});
	expect(found?.extraTime && durationToMinutes(found.extraTime)).toBe(30);
	expect(Object.keys(found ?? {})).not.toContain("note");
});

test("findOne: another student gets null, as for a student with no exception", async () => {
	const { ctx, first } = await withExceptions();
	const bystander = await enroll(ctx.course.id);
	const pk = {
		course: ctx.course.id,
		exam: first.slug,
		username: ctx.student.username,
	};
	const seen = await db.examException.findOne(pk, { actor: bystander });
	const none = await db.examException.findOne(
		{ ...pk, username: bystander.username },
		{ actor: bystander },
	);
	expect(seen).toBeNull();
	expect(none).toBeNull();
});

test("findMany: the course owner gets every exception ordered by exam slug then username", async () => {
	const { ctx, other, first, second } = await withExceptions();
	const rows = await db.examException.findMany(
		{ course: ctx.course.id },
		{ actor: ctx.instructor },
	);
	const usernames = [ctx.student.username, other.username].sort();
	expect(rows.map((r) => [r.exam, r.username])).toEqual([
		[first.slug, usernames[0]],
		[first.slug, usernames[1]],
		[second.slug, ctx.student.username],
	]);
	expect(rows.every((r) => "note" in r)).toBe(true);
});

test("findMany: filters narrow by exam and by username", async () => {
	const { ctx, other, first, second } = await withExceptions();
	const opts = { actor: ctx.instructor };
	const onFirst = await db.examException.findMany(
		{ course: ctx.course.id, exam: first.slug },
		opts,
	);
	expect(onFirst.map((r) => r.username).sort()).toEqual(
		[ctx.student.username, other.username].sort(),
	);
	const ofStudent = await db.examException.findMany(
		{ course: ctx.course.id, username: ctx.student.username },
		opts,
	);
	expect(ofStudent.map((r) => r.exam)).toEqual([first.slug, second.slug]);
	const both = await db.examException.findMany(
		{
			course: ctx.course.id,
			exam: second.slug,
			username: ctx.student.username,
		},
		opts,
	);
	expect(both).toHaveLength(1);
});

test("findMany: exceptions of another course are not listed", async () => {
	const { ctx } = await withExceptions();
	const elsewhere = await setup();
	const rows = await db.examException.findMany(
		{ course: elsewhere.course.id },
		{ actor: elsewhere.instructor },
	);
	expect(rows).toEqual([]);
	expect(ctx.course.id).not.toBe(elsewhere.course.id);
});

test("findMany: a student gets only their own exceptions, without note, whatever the filter says", async () => {
	const { ctx, other, first, second } = await withExceptions();
	const opts = { actor: ctx.student };
	const own = await db.examException.findMany({ course: ctx.course.id }, opts);
	expect(own.map((r) => [r.exam, r.username])).toEqual([
		[first.slug, ctx.student.username],
		[second.slug, ctx.student.username],
	]);
	for (const row of own) expect(Object.keys(row)).not.toContain("note");

	const aimedAtOther = await db.examException.findMany(
		{ course: ctx.course.id, username: other.username },
		opts,
	);
	expect(aimedAtOther.every((r) => r.username === ctx.student.username)).toBe(
		true,
	);
});

test("findMany: a student with no exception gets nothing", async () => {
	const { ctx } = await withExceptions();
	const bystander = await enroll(ctx.course.id);
	const rows = await db.examException.findMany(
		{ course: ctx.course.id },
		{ actor: bystander },
	);
	expect(rows).toEqual([]);
});

// ---------------------------------------------------------------------------
// Update, upsert and delete
// ---------------------------------------------------------------------------

function pkOf(ctx: Ctx, exam: { slug: string }) {
	return {
		course: ctx.course.id,
		exam: exam.slug,
		username: ctx.student.username,
	};
}

test("update: changes the given fields and keeps the others", async () => {
	const ctx = await setup();
	const exam = await makeExam(ctx, {});
	await createException(ctx, exam, {
		extraTime: { minutes: 30 },
		note: "atestado",
	});
	const updated = await db.examException.update(
		pkOf(ctx, exam),
		{ extraTime: { minutes: 45 } },
		FULL_ACCESS,
	);
	expect(updated.extraTime && durationToMinutes(updated.extraTime)).toBe(45);
	expect(updated.note).toBe("atestado");
});

test("update: clearing the extra time of an exception with no makeup date is refused", async () => {
	const ctx = await setup();
	const exam = await makeExam(ctx, {});
	await createException(ctx, exam, { extraTime: { minutes: 30 } });
	await refusal(
		db.examException.update(pkOf(ctx, exam), { extraTime: null }, FULL_ACCESS),
	);
	await refusal(
		db.examException.update(
			pkOf(ctx, exam),
			{ extraTime: { minutes: 0 } },
			FULL_ACCESS,
		),
	);
	const kept = await db.examException.findOne(pkOf(ctx, exam), FULL_ACCESS);
	expect(kept?.extraTime && durationToMinutes(kept.extraTime)).toBe(30);
});

test("update: clearing the extra time is accepted while a makeup date remains", async () => {
	const ctx = await setup();
	const exam = await makeExam(ctx, {});
	const makeup = fromNow(60 * 48);
	await createException(ctx, exam, {
		extraTime: { minutes: 30 },
		scheduledAt: makeup,
	});
	const updated = await db.examException.update(
		pkOf(ctx, exam),
		{ extraTime: null },
		FULL_ACCESS,
	);
	expect(updated.extraTime).toBeNull();
	expect(updated.scheduledAt).toEqual(makeup);
});

test("update: a makeup date on an exam without duration is refused", async () => {
	const ctx = await setup();
	const exam = await makeExam(ctx, { timed: false });
	await createException(ctx, exam, { extraTime: { minutes: 30 } });
	await refusal(
		db.examException.update(
			pkOf(ctx, exam),
			{ scheduledAt: fromNow(60 * 48) },
			FULL_ACCESS,
		),
	);
});

test("update: extra time over 24 hours is refused", async () => {
	const ctx = await setup();
	const exam = await makeExam(ctx, {});
	await createException(ctx, exam, { extraTime: { minutes: 30 } });
	await refusal(
		db.examException.update(
			pkOf(ctx, exam),
			{ extraTime: { hours: 25 } },
			FULL_ACCESS,
		),
	);
});

test("update: an exception that does not exist is NotFound", async () => {
	const ctx = await setup();
	const exam = await makeExam(ctx, {});
	await expect(
		db.examException.update(
			pkOf(ctx, exam),
			{ extraTime: { minutes: 30 } },
			FULL_ACCESS,
		),
	).rejects.toBeInstanceOf(NotFound);
});

test("upsert: creates the exception, then updates it in place", async () => {
	const ctx = await setup();
	const exam = await makeExam(ctx, {});
	const input = { ...pkOf(ctx, exam), note: "atestado" };
	const created = await db.examException.upsert(
		{ ...input, extraTime: { minutes: 30 } },
		FULL_ACCESS,
	);
	const updated = await db.examException.upsert(
		{ ...input, extraTime: { minutes: 60 }, note: undefined },
		FULL_ACCESS,
	);
	expect(updated.id).toBe(created.id);
	expect(updated.extraTime && durationToMinutes(updated.extraTime)).toBe(60);
	expect(updated.note).toBe("atestado");
	const rows = await db.examException.findMany(
		{ course: ctx.course.id, exam: exam.slug },
		FULL_ACCESS,
	);
	expect(rows).toHaveLength(1);
});

test("upsert: an exception granting nothing is refused on either branch", async () => {
	const ctx = await setup();
	const exam = await makeExam(ctx, {});
	const empty = { ...pkOf(ctx, exam), extraTime: null };
	await refusal(db.examException.upsert(empty, FULL_ACCESS));
	await createException(ctx, exam, { extraTime: { minutes: 30 } });
	await refusal(db.examException.upsert(empty, FULL_ACCESS));
});

test("delete: removes the exception, so findOne returns null", async () => {
	const ctx = await setup();
	const exam = await makeExam(ctx, {});
	await createException(ctx, exam, { extraTime: { minutes: 30 } });
	await db.examException.delete(pkOf(ctx, exam), FULL_ACCESS);
	expect(
		await db.examException.findOne(pkOf(ctx, exam), FULL_ACCESS),
	).toBeNull();
	await expect(
		db.examException.delete(pkOf(ctx, exam), FULL_ACCESS),
	).rejects.toBeInstanceOf(NotFound);
});

test("delete: the student can be given a new exception afterwards", async () => {
	const ctx = await setup();
	const exam = await makeExam(ctx, {});
	await createException(ctx, exam, { extraTime: { minutes: 30 } });
	await db.examException.delete(pkOf(ctx, exam), FULL_ACCESS);
	const again = await createException(ctx, exam, {
		extraTime: { minutes: 15 },
	});
	expect(again.extraTime && durationToMinutes(again.extraTime)).toBe(15);
});

// ---------------------------------------------------------------------------
// Write permission
// ---------------------------------------------------------------------------

test("writes: the course owner may create, update and delete", async () => {
	const ctx = await setup();
	const exam = await makeExam(ctx, {});
	const opts = { actor: ctx.instructor };
	await db.examException.create(
		{ ...pkOf(ctx, exam), extraTime: { minutes: 30 } },
		opts,
	);
	await db.examException.update(
		pkOf(ctx, exam),
		{ extraTime: { minutes: 45 } },
		opts,
	);
	await db.examException.delete(pkOf(ctx, exam), opts);
	expect(await db.examException.findOne(pkOf(ctx, exam), opts)).toBeNull();
});

test("writes: a student is refused, even for their own exception", async () => {
	const ctx = await setup();
	const exam = await makeExam(ctx, {});
	const opts = { actor: ctx.student };
	await expect(
		db.examException.create(
			{ ...pkOf(ctx, exam), extraTime: { minutes: 30 } },
			opts,
		),
	).rejects.toBeInstanceOf(NotAllowed);
	await createException(ctx, exam, { extraTime: { minutes: 30 } });
	await expect(
		db.examException.update(
			pkOf(ctx, exam),
			{ extraTime: { minutes: 90 } },
			opts,
		),
	).rejects.toBeInstanceOf(NotAllowed);
	await expect(
		db.examException.upsert(
			{ ...pkOf(ctx, exam), extraTime: { minutes: 90 } },
			opts,
		),
	).rejects.toBeInstanceOf(NotAllowed);
	await expect(
		db.examException.delete(pkOf(ctx, exam), opts),
	).rejects.toBeInstanceOf(NotAllowed);
	const kept = await db.examException.findOne(pkOf(ctx, exam), FULL_ACCESS);
	expect(kept?.extraTime && durationToMinutes(kept.extraTime)).toBe(30);
});

test("writes: an instructor of another course is refused", async () => {
	const ctx = await setup();
	const exam = await makeExam(ctx, {});
	const stranger = await persistedUserFactory.create({ role: "INSTRUCTOR" });
	const opts = { actor: stranger };
	await expect(
		db.examException.create(
			{ ...pkOf(ctx, exam), extraTime: { minutes: 30 } },
			opts,
		),
	).rejects.toBeInstanceOf(NotAllowed);
	await createException(ctx, exam, { extraTime: { minutes: 30 } });
	await expect(
		db.examException.update(
			pkOf(ctx, exam),
			{ extraTime: { minutes: 90 } },
			opts,
		),
	).rejects.toBeInstanceOf(NotAllowed);
	await expect(
		db.examException.delete(pkOf(ctx, exam), opts),
	).rejects.toBeInstanceOf(NotAllowed);
});
