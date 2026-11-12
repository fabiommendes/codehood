import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { PreconditionFailed } from "@/core/error";
import type { CourseId } from "@/core/schemas";
import { db } from "@/db";
import { repositoryTree } from "@/fixtures/repository.factory";

/// ADR 0013 for the content services: resource, calendarEvent, timeSlot and
/// repository. Every fixture creates its own rows under unique keys.

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

async function makeCourse() {
	const edition = `${5000 + ++seq}-1`;
	await db.edition.create(
		{
			slug: edition,
			name: edition,
			startAt: new Date("2026-01-01"),
			endAt: new Date("2030-12-31"),
		},
		FULL_ACCESS,
	);
	const discipline = `cc-d-${uniq()}`;
	await db.discipline.create(
		{ slug: discipline, name: discipline },
		FULL_ACCESS,
	);
	const instructor = `cc-i-${uniq()}`;
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
			discipline,
			instructor,
			edition,
			startAt: new Date("2026-02-02T00:00:00Z"),
			endAt: new Date("2026-06-01T00:00:00Z"),
		},
		FULL_ACCESS,
	);
	return course.id as CourseId;
}

const slotInput = (course: CourseId, slug = `s-${uniq()}`) => ({
	course,
	slug,
	day: "MONDAY" as const,
	start: { hour: 8, minute: 0 },
	duration: { hours: 1 },
});

/// A slot on Monday, or on Wednesday in a course given, which already has
/// the Monday one: slots of a course must not overlap.
async function makeSlot(course?: CourseId) {
	const courseId = course ?? (await makeCourse());
	return db.timeSlot.create(
		{ ...slotInput(courseId), day: course ? "WEDNESDAY" : "MONDAY" },
		FULL_ACCESS,
	);
}

async function makeEvent(course?: CourseId) {
	const slot = await makeSlot(course);
	const event = await db.calendarEvent.create(
		{ course: slot.courseId, timeSlot: slot.id, week: 1, title: "Class" },
		FULL_ACCESS,
	);
	return { slot, event };
}

const resourceInput = (course: CourseId, extra: object = {}) => ({
	course,
	slug: `r-${uniq()}`,
	title: "Link",
	data: { type: "LINK" as const, url: "https://example.test/a" },
	...extra,
});

async function makeResource(course?: CourseId, extra: object = {}) {
	const courseId = course ?? (await makeCourse());
	return db.resource.create(resourceInput(courseId, extra), FULL_ACCESS);
}

async function makeRepository(course?: CourseId) {
	const courseId = course ?? (await makeCourse());
	const slug = `repo-${uniq()}`;
	const repository = await db.repository.create(
		{ course: courseId, slug },
		FULL_ACCESS,
	);
	return { repository, pk: { course: courseId, slug } };
}

//
// Resource
//

test("resource.update: right version writes and moves updatedAt", async () => {
	const r = await makeResource();
	const out = await db.resource.update(
		{ id: r.id },
		{ title: "New" },
		at(r.updatedAt),
	);
	expect(out.title).toBe("New");
	expect(out.updatedAt.getTime()).toBeGreaterThan(r.updatedAt.getTime());
});

test("resource.update: stale version throws with the current one and writes nothing", async () => {
	const r = await makeResource();
	const err = await failure(
		db.resource.update({ id: r.id }, { title: "Nope" }, at(STALE)),
	);
	expect(err.updatedAt).toEqual(r.updatedAt);
	expect((await db.resource.findOne({ id: r.id }, FULL_ACCESS))?.title).toBe(
		r.title,
	);
});

test("resource.update: absent expectation writes", async () => {
	const r = await makeResource();
	const out = await db.resource.update(
		{ id: r.id },
		{ title: "Free" },
		FULL_ACCESS,
	);
	expect(out.title).toBe("Free");
	expect(out.updatedAt.getTime()).toBeGreaterThan(r.updatedAt.getTime());
});

test("resource.update: a Date on a missing row is a 412 with null, not a NotFound", async () => {
	const err = await failure(
		db.resource.update({ id: 987654321 as never }, { title: "x" }, at(STALE)),
	);
	expect(err.updatedAt).toBeNull();
});

test("resource.upsert: null creates, then fails when it exists", async () => {
	const course = await makeCourse();
	const input = resourceInput(course);
	const created = await db.resource.upsert(input, at(null));
	expect(created.slug).toBe(input.slug);
	const err = await failure(db.resource.upsert(input, at(null)));
	expect(err.updatedAt).toEqual(created.updatedAt);
});

test("resource.upsert: Date updates when right, fails when stale or absent", async () => {
	const r = await makeResource();
	const input = { ...resourceInput(r.courseId as CourseId), slug: r.slug };
	const out = await db.resource.upsert(
		{ ...input, title: "Up" },
		at(r.updatedAt),
	);
	expect(out.title).toBe("Up");
	await failure(
		db.resource.upsert({ ...input, title: "Late" }, at(r.updatedAt)),
	);
	const fresh = resourceInput(r.courseId as CourseId);
	const err = await failure(db.resource.upsert(fresh, at(STALE)));
	expect(err.updatedAt).toBeNull();
});

test("resource.delete: right version deletes, stale throws and keeps the row", async () => {
	const r = await makeResource();
	await failure(db.resource.delete({ id: r.id }, at(STALE)));
	expect(await db.resource.findOne({ id: r.id }, FULL_ACCESS)).not.toBeNull();
	await db.resource.delete({ id: r.id }, at(r.updatedAt));
	expect(await db.resource.findOne({ id: r.id }, FULL_ACCESS)).toBeNull();
});

test("resource.delete: a Date on a missing row is a 412 with null", async () => {
	const err = await failure(
		db.resource.delete({ id: 987654321 as never }, at(STALE)),
	);
	expect(err.updatedAt).toBeNull();
});

test("resource.create of a FILE returns the updatedAt that is stored", async () => {
	const course = await makeCourse();
	const created = await db.resource.create(
		{
			...resourceInput(course),
			data: { type: "FILE", filename: "a.txt", buffer: Buffer.from(uniq()) },
		},
		FULL_ACCESS,
	);
	const stored = await db.resource.findOne({ id: created.id }, FULL_ACCESS);
	expect(created.updatedAt).toEqual(stored?.updatedAt);
});

test("resource.update to a FILE: the version moves once and the read model carries it", async () => {
	const r = await makeResource();
	const out = await db.resource.update(
		{ id: r.id },
		{ data: { type: "FILE", filename: "b.txt", buffer: Buffer.from(uniq()) } },
		at(r.updatedAt),
	);
	const stored = await db.resource.findOne({ id: r.id }, FULL_ACCESS);
	expect(out.updatedAt).toEqual(stored?.updatedAt);
});

//
// Time slot
//

test("timeSlot.update: right version writes and moves updatedAt", async () => {
	const slot = await makeSlot();
	const out = await db.timeSlot.update(
		{ id: slot.id },
		{ title: "T" },
		at(slot.updatedAt),
	);
	expect(out.title).toBe("T");
	expect(out.updatedAt.getTime()).toBeGreaterThan(slot.updatedAt.getTime());
});

test("timeSlot.update: stale version throws and writes nothing", async () => {
	const slot = await makeSlot();
	const err = await failure(
		db.timeSlot.update({ id: slot.id }, { title: "Nope" }, at(STALE)),
	);
	expect(err.updatedAt).toEqual(slot.updatedAt);
	expect((await db.timeSlot.findOne({ id: slot.id }, FULL_ACCESS))?.title).toBe(
		slot.title,
	);
});

test("timeSlot.update: stale version writes no derived event change", async () => {
	const { slot, event } = await makeEvent();
	await failure(
		db.timeSlot.update({ id: slot.id }, { day: "TUESDAY" }, at(STALE)),
	);
	const after = await db.calendarEvent.findOne({ id: event.id }, FULL_ACCESS);
	expect(after?.updatedAt).toEqual(event.updatedAt);
	expect(after?.startAt).toEqual(event.startAt);
});

test("timeSlot.update: a Date on a missing row is a 412 with null", async () => {
	const err = await failure(
		db.timeSlot.update({ id: 987654321 as never }, { title: "x" }, at(STALE)),
	);
	expect(err.updatedAt).toBeNull();
});

test("timeSlot.upsert: null creates, then fails when it exists", async () => {
	const course = await makeCourse();
	const input = slotInput(course);
	const created = await db.timeSlot.upsert(input, at(null));
	const err = await failure(db.timeSlot.upsert(input, at(null)));
	expect(err.updatedAt).toEqual(created.updatedAt);
});

test("timeSlot.upsert: Date updates when right, fails when stale or absent", async () => {
	const slot = await makeSlot();
	const input = {
		...slotInput(slot.courseId as CourseId, slot.slug),
		title: "Up",
	};
	const out = await db.timeSlot.upsert(input, at(slot.updatedAt));
	expect(out.title).toBe("Up");
	await failure(db.timeSlot.upsert(input, at(slot.updatedAt)));
	const err = await failure(
		db.timeSlot.upsert(slotInput(slot.courseId as CourseId), at(STALE)),
	);
	expect(err.updatedAt).toBeNull();
});

test("timeSlot.delete: right version deletes, stale throws and keeps the row", async () => {
	const slot = await makeSlot();
	await failure(db.timeSlot.delete({ id: slot.id }, at(STALE)));
	expect(
		await db.timeSlot.findOne({ id: slot.id }, FULL_ACCESS),
	).not.toBeNull();
	await db.timeSlot.delete({ id: slot.id }, at(slot.updatedAt));
	expect(await db.timeSlot.findOne({ id: slot.id }, FULL_ACCESS)).toBeNull();
});

test("timeSlot.delete: a Date on a missing row is a 412 with null", async () => {
	const err = await failure(
		db.timeSlot.delete({ id: 987654321 as never }, at(STALE)),
	);
	expect(err.updatedAt).toBeNull();
});

test("timeSlot.update of day or duration bumps the slot's events and leaves other events alone", async () => {
	const { slot, event } = await makeEvent();
	const other = await makeEvent(slot.courseId as CourseId);
	await db.timeSlot.update({ id: slot.id }, { day: "TUESDAY" }, FULL_ACCESS);
	const moved = await db.calendarEvent.findOne({ id: event.id }, FULL_ACCESS);
	expect(moved?.startAt).not.toEqual(event.startAt);
	expect(moved?.updatedAt.getTime()).toBeGreaterThan(event.updatedAt.getTime());
	const untouched = await db.calendarEvent.findOne(
		{ id: other.event.id },
		FULL_ACCESS,
	);
	expect(untouched?.updatedAt).toEqual(other.event.updatedAt);
});

test("timeSlot.update of the title alone does not touch the slot's events", async () => {
	const { slot, event } = await makeEvent();
	await db.timeSlot.update({ id: slot.id }, { title: "Renamed" }, FULL_ACCESS);
	const after = await db.calendarEvent.findOne({ id: event.id }, FULL_ACCESS);
	expect(after?.updatedAt).toEqual(event.updatedAt);
});

//
// Calendar event
//

test("calendarEvent.update: right version writes and moves updatedAt", async () => {
	const { event } = await makeEvent();
	const out = await db.calendarEvent.update(
		{ id: event.id },
		{ title: "New" },
		at(event.updatedAt),
	);
	expect(out.title).toBe("New");
	expect(out.updatedAt.getTime()).toBeGreaterThan(event.updatedAt.getTime());
});

test("calendarEvent.update: stale version throws and writes nothing", async () => {
	const { event } = await makeEvent();
	const err = await failure(
		db.calendarEvent.update({ id: event.id }, { title: "Nope" }, at(STALE)),
	);
	expect(err.updatedAt).toEqual(event.updatedAt);
	expect(
		(await db.calendarEvent.findOne({ id: event.id }, FULL_ACCESS))?.title,
	).toBe(event.title);
});

test("calendarEvent.update: a Date on a missing row is a 412 with null", async () => {
	const err = await failure(
		db.calendarEvent.update(
			{ id: 987654321 as never },
			{ title: "x" },
			at(STALE),
		),
	);
	expect(err.updatedAt).toBeNull();
});

test("calendarEvent.update: a stale version does not replace the repositories", async () => {
	const { event } = await makeEvent();
	const { pk } = await makeRepository(event.courseId as CourseId);
	await failure(
		db.calendarEvent.update(
			{ id: event.id },
			{ repositories: [pk.slug] },
			at(STALE),
		),
	);
	const after = await db.calendarEvent.findOne({ id: event.id }, FULL_ACCESS);
	expect(after?.repositories).toEqual([]);
});

test("calendarEvent.update: changing only the repositories moves the event's updatedAt", async () => {
	const { event } = await makeEvent();
	const { pk } = await makeRepository(event.courseId as CourseId);
	const out = await db.calendarEvent.update(
		{ id: event.id },
		{ repositories: [pk.slug] },
		at(event.updatedAt),
	);
	expect(out.repositories.map((r) => r.slug)).toEqual([pk.slug]);
	expect(out.updatedAt.getTime()).toBeGreaterThan(event.updatedAt.getTime());
	await failure(
		db.calendarEvent.update(
			{ id: event.id },
			{ repositories: [] },
			at(event.updatedAt),
		),
	);
});

test("calendarEvent.upsert: null creates, then fails when it exists", async () => {
	const slot = await makeSlot();
	const input = {
		course: slot.courseId as CourseId,
		timeSlot: slot.id,
		week: 2,
		title: "Class",
	};
	const created = await db.calendarEvent.upsert(input, at(null));
	const err = await failure(db.calendarEvent.upsert(input, at(null)));
	expect(err.updatedAt).toEqual(created.updatedAt);
});

test("calendarEvent.upsert: Date updates when right, fails when stale or absent", async () => {
	const { slot, event } = await makeEvent();
	const input = {
		course: slot.courseId as CourseId,
		timeSlot: slot.id,
		week: event.week,
		title: "Up",
	};
	const out = await db.calendarEvent.upsert(input, at(event.updatedAt));
	expect(out.title).toBe("Up");
	await failure(db.calendarEvent.upsert(input, at(event.updatedAt)));
	const err = await failure(
		db.calendarEvent.upsert({ ...input, week: event.week + 1 }, at(STALE)),
	);
	expect(err.updatedAt).toBeNull();
});

test("calendarEvent.delete: right version deletes, stale throws and keeps the row", async () => {
	const { event } = await makeEvent();
	await failure(db.calendarEvent.delete({ id: event.id }, at(STALE)));
	expect(
		await db.calendarEvent.findOne({ id: event.id }, FULL_ACCESS),
	).not.toBeNull();
	await db.calendarEvent.delete({ id: event.id }, at(event.updatedAt));
	expect(
		await db.calendarEvent.findOne({ id: event.id }, FULL_ACCESS),
	).toBeNull();
});

test("calendarEvent.delete: a Date on a missing row is a 412 with null", async () => {
	const err = await failure(
		db.calendarEvent.delete({ id: 987654321 as never }, at(STALE)),
	);
	expect(err.updatedAt).toBeNull();
});

test("calendarEvent.delete bumps the resources that pointed at it", async () => {
	const { event } = await makeEvent();
	const course = event.courseId as CourseId;
	const pointing = await makeResource(course, {
		event: { week: event.week, timeSlot: event.timeSlot.slug },
	});
	const bystander = await makeResource(course);
	expect(pointing.event?.id).toBe(event.id);

	await db.calendarEvent.delete({ id: event.id }, FULL_ACCESS);

	const after = await db.resource.findOne({ id: pointing.id }, FULL_ACCESS);
	expect(after?.event).toBeNull();
	expect(after?.updatedAt.getTime()).toBeGreaterThan(
		pointing.updatedAt.getTime(),
	);
	await failure(
		db.resource.update(
			{ id: pointing.id },
			{ title: "x" },
			at(pointing.updatedAt),
		),
	);
	const other = await db.resource.findOne({ id: bystander.id }, FULL_ACCESS);
	expect(other?.updatedAt).toEqual(bystander.updatedAt);
});

test("calendarEvent.delete with a stale version leaves the resources untouched", async () => {
	const { event } = await makeEvent();
	const pointing = await makeResource(event.courseId as CourseId, {
		event: { week: event.week, timeSlot: event.timeSlot.slug },
	});
	await failure(db.calendarEvent.delete({ id: event.id }, at(STALE)));
	const after = await db.resource.findOne({ id: pointing.id }, FULL_ACCESS);
	expect(after?.updatedAt).toEqual(pointing.updatedAt);
	expect(after?.event?.id).toBe(event.id);
});

//
// Repository
//

test("repository.upsert: null creates, then fails when it exists", async () => {
	const course = await makeCourse();
	const input = { course, slug: `repo-${uniq()}` };
	const created = await db.repository.upsert(input, at(null));
	const err = await failure(db.repository.upsert(input, at(null)));
	expect(err.updatedAt).toEqual(created.updatedAt);
});

test("repository.upsert: Date returns the repository when right, fails when stale or absent", async () => {
	const { repository, pk } = await makeRepository();
	const out = await db.repository.upsert(pk, at(repository.updatedAt));
	expect(out.id).toBe(repository.id);
	const err = await failure(db.repository.upsert(pk, at(STALE)));
	expect(err.updatedAt).toEqual(repository.updatedAt);
	const absent = await failure(
		db.repository.upsert(
			{ course: pk.course, slug: `repo-${uniq()}` },
			at(STALE),
		),
	);
	expect(absent.updatedAt).toBeNull();
});

test("repository.delete: right version deletes, stale throws and keeps the row", async () => {
	const { repository, pk } = await makeRepository();
	await failure(db.repository.delete(pk, at(STALE)));
	expect(await db.repository.findOne(pk, FULL_ACCESS)).not.toBeNull();
	await db.repository.delete(pk, at(repository.updatedAt));
	expect(await db.repository.findOne(pk, FULL_ACCESS)).toBeNull();
});

test("repository.delete: a Date on a missing repository is a 412 with null", async () => {
	const course = await makeCourse();
	const err = await failure(
		db.repository.delete({ course, slug: `repo-${uniq()}` }, at(STALE)),
	);
	expect(err.updatedAt).toBeNull();
});

test("repository.delete: absent expectation on a missing repository is still a no-op", async () => {
	const course = await makeCourse();
	await db.repository.delete({ course, slug: `repo-${uniq()}` }, FULL_ACCESS);
});

test("repository.delete bumps the events that cited it, and only those", async () => {
	const { event } = await makeEvent();
	const course = event.courseId as CourseId;
	const { repository, pk } = await makeRepository(course);
	const cited = await db.calendarEvent.update(
		{ id: event.id },
		{ repositories: [pk.slug] },
		FULL_ACCESS,
	);
	const other = await makeEvent(course);

	await db.repository.delete(pk, at(repository.updatedAt));

	const after = await db.calendarEvent.findOne({ id: event.id }, FULL_ACCESS);
	expect(after?.repositories).toEqual([]);
	expect(after?.updatedAt.getTime()).toBeGreaterThan(cited.updatedAt.getTime());
	const untouched = await db.calendarEvent.findOne(
		{ id: other.event.id },
		FULL_ACCESS,
	);
	expect(untouched?.updatedAt).toEqual(other.event.updatedAt);
});

test("repository.delete with a stale version leaves the citing events untouched", async () => {
	const { event } = await makeEvent();
	const { pk } = await makeRepository(event.courseId as CourseId);
	const cited = await db.calendarEvent.update(
		{ id: event.id },
		{ repositories: [pk.slug] },
		FULL_ACCESS,
	);
	await failure(db.repository.delete(pk, at(STALE)));
	const after = await db.calendarEvent.findOne({ id: event.id }, FULL_ACCESS);
	expect(after?.updatedAt).toEqual(cited.updatedAt);
	expect(after?.repositories).toHaveLength(1);
});

/// A repository with one file stored, ready to commit.
async function stagedRepository() {
	const made = await makeRepository();
	const { files, tree } = repositoryTree({ "README.md": `# ${uniq()}\n` });
	await db.repository.addFiles(made.pk, files, FULL_ACCESS);
	return { ...made, files, tree };
}

test("repository.commit: right version commits and moves updatedAt", async () => {
	const { repository, pk, tree } = await stagedRepository();
	const out = await db.repository.commit(
		pk,
		{ tree },
		at(repository.updatedAt),
	);
	expect(out.head).not.toBeNull();
	expect(out.updatedAt.getTime()).toBeGreaterThan(
		repository.updatedAt.getTime(),
	);
	const stored = await db.repository.findOne(pk, FULL_ACCESS);
	expect(stored?.updatedAt).toEqual(out.updatedAt);
});

test("repository.commit: stale version throws and records nothing", async () => {
	const { repository, pk, tree } = await stagedRepository();
	const err = await failure(db.repository.commit(pk, { tree }, at(STALE)));
	expect(err.updatedAt).toEqual(repository.updatedAt);
	expect((await db.repository.findOne(pk, FULL_ACCESS))?.head).toBeNull();
});

test("repository.commit: a stale version is refused even when the tree is already the head", async () => {
	const { pk, tree } = await stagedRepository();
	const first = await db.repository.commit(pk, { tree }, FULL_ACCESS);
	await failure(db.repository.commit(pk, { tree }, at(STALE)));
	const same = await db.repository.commit(pk, { tree }, at(first.updatedAt));
	expect(same.head).toBe(first.head);
});

test("repository.rotateToken: right version rotates, stale throws", async () => {
	const { repository, pk } = await makeRepository();
	await failure(db.repository.rotateToken(pk, at(STALE)));
	const out = await db.repository.rotateToken(pk, at(repository.updatedAt));
	expect(out.cloneUrl).not.toBe(repository.cloneUrl);
	expect(out.updatedAt.getTime()).toBeGreaterThan(
		repository.updatedAt.getTime(),
	);
});

test("repository.addFiles: stale version throws and stores nothing", async () => {
	const { repository, pk } = await makeRepository();
	const { files } = repositoryTree({ "a.txt": uniq() });
	const err = await failure(db.repository.addFiles(pk, files, at(STALE)));
	expect(err.updatedAt).toEqual(repository.updatedAt);
	const ok = await db.repository.addFiles(pk, files, at(repository.updatedAt));
	expect(ok.added).toHaveLength(1);
});
