import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { InvalidData, NotFound, PreconditionFailed } from "@/core/error";
import type { CourseId } from "@/core/schemas";
import { db } from "@/db";
import { prisma } from "@/db/client";

let seq = 0;
const uniq = () => `${++seq}-${Math.random().toString(36).slice(2, 7)}`;
const STALE = new Date(0);

//
// Discipline
//

async function makeDiscipline() {
	const slug = `cw-d-${uniq()}`;
	return db.discipline.create({ slug, name: slug }, FULL_ACCESS);
}

test("discipline: read model exposes updatedAt", async () => {
	const d = await makeDiscipline();
	expect(d.updatedAt).toBeInstanceOf(Date);
});

test("discipline.update: right version writes, new version differs", async () => {
	const d = await makeDiscipline();
	const out = await db.discipline.update(
		{ slug: d.slug },
		{ name: "Changed" },
		{ ...FULL_ACCESS, expectedUpdatedAt: d.updatedAt },
	);
	expect(out.name).toBe("Changed");
	expect(out.updatedAt.getTime()).toBeGreaterThan(d.updatedAt.getTime());
});

test("discipline.update: stale version throws and writes nothing", async () => {
	const d = await makeDiscipline();
	const err = await db.discipline
		.update(
			{ slug: d.slug },
			{ name: "Nope" },
			{ ...FULL_ACCESS, expectedUpdatedAt: STALE },
		)
		.catch((e) => e);
	expect(err).toBeInstanceOf(PreconditionFailed);
	expect((err as PreconditionFailed).updatedAt).toEqual(d.updatedAt);
	const now = await db.discipline.findOne({ slug: d.slug }, FULL_ACCESS);
	expect(now?.name).toBe(d.name);
});

test("discipline.update: absent expectation writes and bumps updatedAt", async () => {
	const d = await makeDiscipline();
	const out = await db.discipline.update(
		{ slug: d.slug },
		{ name: "Free" },
		FULL_ACCESS,
	);
	expect(out.name).toBe("Free");
	expect(out.updatedAt.getTime()).toBeGreaterThan(d.updatedAt.getTime());
});

test("discipline.upsert: null creates, then fails when it exists", async () => {
	const slug = `cw-d-${uniq()}`;
	const created = await db.discipline.upsert(
		{ slug, name: "A" },
		{ ...FULL_ACCESS, expectedUpdatedAt: null },
	);
	expect(created.name).toBe("A");
	const err = await db.discipline
		.upsert({ slug, name: "B" }, { ...FULL_ACCESS, expectedUpdatedAt: null })
		.catch((e) => e);
	expect(err).toBeInstanceOf(PreconditionFailed);
	expect((err as PreconditionFailed).updatedAt).toEqual(created.updatedAt);
});

test("discipline.upsert: Date updates when right, fails when stale or absent", async () => {
	const d = await makeDiscipline();
	const out = await db.discipline.upsert(
		{ slug: d.slug, name: "Up" },
		{ ...FULL_ACCESS, expectedUpdatedAt: d.updatedAt },
	);
	expect(out.name).toBe("Up");
	await expect(
		db.discipline.upsert(
			{ slug: d.slug, name: "Stale" },
			{ ...FULL_ACCESS, expectedUpdatedAt: d.updatedAt },
		),
	).rejects.toBeInstanceOf(PreconditionFailed);
	const err = await db.discipline
		.upsert(
			{ slug: `cw-d-${uniq()}`, name: "X" },
			{ ...FULL_ACCESS, expectedUpdatedAt: STALE },
		)
		.catch((e) => e);
	expect(err).toBeInstanceOf(PreconditionFailed);
	expect((err as PreconditionFailed).updatedAt).toBeNull();
});

test("discipline.delete: stale keeps the row, right version removes it", async () => {
	const d = await makeDiscipline();
	await expect(
		db.discipline.delete(
			{ slug: d.slug },
			{ ...FULL_ACCESS, expectedUpdatedAt: STALE },
		),
	).rejects.toBeInstanceOf(PreconditionFailed);
	expect(
		await db.discipline.findOne({ slug: d.slug }, FULL_ACCESS),
	).not.toBeNull();
	await db.discipline.delete(
		{ slug: d.slug },
		{ ...FULL_ACCESS, expectedUpdatedAt: d.updatedAt },
	);
	expect(await db.discipline.findOne({ slug: d.slug }, FULL_ACCESS)).toBeNull();
});

test("discipline.delete: a Date on a missing row throws with current null", async () => {
	const err = await db.discipline
		.delete(
			{ slug: `cw-gone-${uniq()}` },
			{ ...FULL_ACCESS, expectedUpdatedAt: new Date() },
		)
		.catch((e) => e);
	expect(err).toBeInstanceOf(PreconditionFailed);
	expect((err as PreconditionFailed).updatedAt).toBeNull();
});

//
// Course
//

async function makeCourse() {
	const edition = `${3000 + ++seq}-1`;
	await db.edition.create(
		{
			slug: edition,
			name: edition,
			startAt: new Date("2026-01-01"),
			endAt: new Date("2030-12-31"),
		},
		FULL_ACCESS,
	);
	const discipline = await makeDiscipline();
	const instructor = `cw-i-${uniq()}`;
	await db.user.create(
		{
			email: `${instructor}@codehood.test`,
			username: instructor,
			name: instructor,
			role: "INSTRUCTOR",
			password: "x",
			githubId: instructor,
			schoolId: instructor,
		},
		FULL_ACCESS,
	);
	const course = await db.course.create(
		{
			discipline: discipline.slug,
			instructor,
			edition,
			startAt: new Date("2026-02-02T00:00:00Z"),
			endAt: new Date("2026-06-01T00:00:00Z"),
		},
		FULL_ACCESS,
	);
	return {
		course,
		pk: { id: course.id as CourseId },
		input: { discipline: discipline.slug, instructor, edition },
	};
}

test("course.update: right version writes and moves updatedAt", async () => {
	const { course, pk } = await makeCourse();
	const out = await db.course.update(
		pk,
		{ description: "new" },
		{ ...FULL_ACCESS, expectedUpdatedAt: course.updatedAt },
	);
	expect(out.description).toBe("new");
	expect(out.updatedAt.getTime()).toBeGreaterThan(course.updatedAt.getTime());
});

test("course.update: stale version throws and writes nothing", async () => {
	const { course, pk } = await makeCourse();
	const err = await db.course
		.update(
			pk,
			{ description: "no" },
			{ ...FULL_ACCESS, expectedUpdatedAt: STALE },
		)
		.catch((e) => e);
	expect(err).toBeInstanceOf(PreconditionFailed);
	expect((err as PreconditionFailed).updatedAt).toEqual(course.updatedAt);
	expect((await db.course.findOne(pk, FULL_ACCESS))?.description).toBeNull();
});

test("course.update: absent expectation writes", async () => {
	const { course, pk } = await makeCourse();
	const out = await db.course.update(pk, { description: "free" }, FULL_ACCESS);
	expect(out.description).toBe("free");
	expect(out.updatedAt.getTime()).toBeGreaterThan(course.updatedAt.getTime());
});

test("course.update: a second write right after the first invalidates the old version", async () => {
	const { course, pk } = await makeCourse();
	const first = await db.course.update(pk, { description: "1" }, FULL_ACCESS);
	await db.course.update(pk, { description: "2" }, FULL_ACCESS);
	await expect(
		db.course.update(
			pk,
			{ description: "3" },
			{ ...FULL_ACCESS, expectedUpdatedAt: first.updatedAt },
		),
	).rejects.toBeInstanceOf(PreconditionFailed);
	expect(first.updatedAt.getTime()).toBeGreaterThan(course.updatedAt.getTime());
});

test("course.upsert: null creates and fails when the course exists", async () => {
	const { input } = await makeCourse();
	const other = { ...input, edition: input.edition };
	const err = await db.course
		.upsert(
			{
				...other,
				startAt: new Date("2026-02-02"),
				endAt: new Date("2026-06-01"),
			},
			{ ...FULL_ACCESS, expectedUpdatedAt: null },
		)
		.catch((e) => e);
	expect(err).toBeInstanceOf(PreconditionFailed);
	expect((err as PreconditionFailed).updatedAt).toBeInstanceOf(Date);
});

test("course.upsert: null creates a course that is absent", async () => {
	const { input } = await makeCourse();
	const discipline = await makeDiscipline();
	const out = await db.course.upsert(
		{
			...input,
			discipline: discipline.slug,
			startAt: new Date("2026-02-02"),
			endAt: new Date("2026-06-01"),
		},
		{ ...FULL_ACCESS, expectedUpdatedAt: null },
	);
	expect(out.discipline.slug).toBe(discipline.slug);
});

test("course.upsert: Date updates when right, fails when stale or absent", async () => {
	const { course, input } = await makeCourse();
	const body = { ...input, startAt: course.startAt, endAt: course.endAt };
	const out = await db.course.upsert(
		{ ...body, description: "up" },
		{ ...FULL_ACCESS, expectedUpdatedAt: course.updatedAt },
	);
	expect(out.description).toBe("up");
	await expect(
		db.course.upsert(
			{ ...body, description: "stale" },
			{ ...FULL_ACCESS, expectedUpdatedAt: course.updatedAt },
		),
	).rejects.toBeInstanceOf(PreconditionFailed);
	const discipline = await makeDiscipline();
	const err = await db.course
		.upsert(
			{ ...body, discipline: discipline.slug },
			{ ...FULL_ACCESS, expectedUpdatedAt: STALE },
		)
		.catch((e) => e);
	expect(err).toBeInstanceOf(PreconditionFailed);
	expect((err as PreconditionFailed).updatedAt).toBeNull();
});

test("course.delete: stale keeps the row, right version removes it", async () => {
	const { course, pk } = await makeCourse();
	await expect(
		db.course.delete(pk, { ...FULL_ACCESS, expectedUpdatedAt: STALE }),
	).rejects.toBeInstanceOf(PreconditionFailed);
	expect(await db.course.findOne(pk, FULL_ACCESS)).not.toBeNull();
	await db.course.delete(pk, {
		...FULL_ACCESS,
		expectedUpdatedAt: course.updatedAt,
	});
	expect(await db.course.findOne(pk, FULL_ACCESS)).toBeNull();
});

test("course.update of startAt bumps the updatedAt of the events it recomputes", async () => {
	const { course, pk } = await makeCourse();
	const slot = await prisma.timeSlot.create({
		data: {
			courseId: course.id,
			slug: "mon",
			day: "MONDAY",
			startMin: 600,
			durationMin: 60,
		},
	});
	const event = await prisma.calendarEvent.create({
		data: {
			courseId: course.id,
			timeSlotId: slot.id,
			week: 0,
			title: "Week 1",
			startAt: course.startAt,
			durationMin: 60,
		},
	});
	await db.course.update(
		pk,
		{ startAt: new Date("2026-02-09T00:00:00Z") },
		FULL_ACCESS,
	);
	const after = await prisma.calendarEvent.findUniqueOrThrow({
		where: { id: event.id },
	});
	expect(after.startAt.getTime()).not.toBe(event.startAt.getTime());
	expect(after.updatedAt.getTime()).toBeGreaterThan(event.updatedAt.getTime());
});

//
// Edition: no updatedAt, so a condition is refused instead of ignored
//

test("edition refuses expectedUpdatedAt on update, upsert and delete", async () => {
	const slug = `${4000 + ++seq}-1`;
	await db.edition.create(
		{
			slug,
			name: slug,
			startAt: new Date("2026-01-01"),
			endAt: new Date("2026-12-31"),
		},
		FULL_ACCESS,
	);
	const opts = { ...FULL_ACCESS, expectedUpdatedAt: new Date() };
	await expect(
		db.edition.update({ slug }, { name: "x" }, opts),
	).rejects.toBeInstanceOf(InvalidData);
	await expect(
		db.edition.upsert(
			{
				slug,
				name: "x",
				startAt: new Date("2026-01-01"),
				endAt: new Date("2026-12-31"),
			},
			opts,
		),
	).rejects.toBeInstanceOf(InvalidData);
	await expect(db.edition.delete({ slug }, opts)).rejects.toBeInstanceOf(
		InvalidData,
	);
	expect(await db.edition.findOne({ slug }, FULL_ACCESS)).not.toBeNull();
});

//
// A missing row
//

test("a Date on a missing row is a 412 with null: course and discipline, update and delete", async () => {
	const at = { ...FULL_ACCESS, expectedUpdatedAt: new Date() };
	const ghostCourse = { id: 2_000_000_000 as CourseId };
	const ghostDiscipline = { slug: `cw-ghost-${uniq()}` };
	const runs: Record<string, () => Promise<unknown>> = {
		"course.update": () =>
			db.course.update(ghostCourse, { description: "x" }, at),
		"course.delete": () => db.course.delete(ghostCourse, at),
		"discipline.update": () =>
			db.discipline.update(ghostDiscipline, { name: "x" }, at),
		"discipline.delete": () => db.discipline.delete(ghostDiscipline, at),
	};
	for (const [name, run] of Object.entries(runs)) {
		const err = await run().catch((e: unknown) => e);
		expect(err, name).toBeInstanceOf(PreconditionFailed);
		expect((err as PreconditionFailed).updatedAt, name).toBeNull();
	}
});

test("without expectedUpdatedAt a missing row is still NotFound on update and delete", async () => {
	const ghostCourse = { id: 2_000_000_000 as CourseId };
	const ghostDiscipline = { slug: `cw-ghost-${uniq()}` };
	await expect(
		db.course.update(ghostCourse, { description: "x" }, FULL_ACCESS),
	).rejects.toBeInstanceOf(NotFound);
	await expect(
		db.course.delete(ghostCourse, FULL_ACCESS),
	).rejects.toBeInstanceOf(NotFound);
	await expect(
		db.discipline.update(ghostDiscipline, { name: "x" }, FULL_ACCESS),
	).rejects.toBeInstanceOf(NotFound);
	await db.discipline.delete(ghostDiscipline, FULL_ACCESS);
});

//
// updatedAt stored in another format, through the services
//

test("services write rows whose updatedAt was stored as SQLite text or an integer", async () => {
	const at = new Date("2026-11-12T18:09:20.000Z");
	const stored = [
		"2026-11-12 18:09:20",
		"2026-11-12T18:09:20+00:00",
		at.getTime(),
	];
	for (const value of stored) {
		const d = await makeDiscipline();
		await prisma.$executeRaw`UPDATE Discipline SET updatedAt = ${value} WHERE slug = ${d.slug}`;
		const readModel = await db.discipline.findOne(
			{ slug: d.slug },
			FULL_ACCESS,
		);
		expect(readModel?.updatedAt.getTime(), String(value)).toBe(at.getTime());
		await db.discipline.update({ slug: d.slug }, { name: "a" }, FULL_ACCESS);
		await prisma.$executeRaw`UPDATE Discipline SET updatedAt = ${value} WHERE slug = ${d.slug}`;
		await db.discipline.update(
			{ slug: d.slug },
			{ name: "b" },
			{ ...FULL_ACCESS, expectedUpdatedAt: at },
		);
		await db.discipline.delete({ slug: d.slug }, FULL_ACCESS);
	}
});
