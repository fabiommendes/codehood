import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db, type schema } from "@/db";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedUserFactory } from "@/fixtures/user.factory";
import { resetDatabase } from "./stories/helpers";

// The two reads the calendar feed is built from: courses a user belongs to, and exams across courses.

test.beforeEach(resetDatabase);

//
// courseFilter.member
//

test("member returns the courses the user teaches and those with an ACTIVE enrollment, nothing else", async () => {
	const person = await persistedUserFactory.create({ role: "INSTRUCTOR" });
	const taught = await persistedCourseFactory.create({
		instructor: person.username,
	});
	const attended = await persistedCourseFactory.create();
	await db.enrollment.create(
		{ course: attended.id, username: person.username },
		FULL_ACCESS,
	);
	const dropped = await persistedCourseFactory.create();
	await db.enrollment.create(
		{ course: dropped.id, username: person.username },
		FULL_ACCESS,
	);
	await db.enrollment.delete(
		{ course: dropped.id, username: person.username },
		FULL_ACCESS,
	);
	await persistedCourseFactory.create({}, { transient: { students: 1 } });

	const courses = await db.course.findMany(
		{ member: person.username },
		FULL_ACCESS,
	);

	expect(courses.map((c) => c.id).sort()).toEqual(
		[taught.id, attended.id].sort(),
	);
});

test("member narrows an admin's view: only courses the admin teaches or attends come back", async () => {
	const admin = await persistedUserFactory.create({ role: "ADMIN" });
	const own = await persistedCourseFactory.create({
		instructor: admin.username,
	});
	await persistedCourseFactory.create();
	await persistedCourseFactory.create();

	const courses = await db.course.findMany(
		{ member: admin.username },
		{ actor: admin },
	);

	expect(courses.map((c) => c.id)).toEqual([own.id]);
});

test("member of a user with no courses returns an empty list", async () => {
	const loner = await persistedUserFactory.create();
	await persistedCourseFactory.create();

	expect(
		await db.course.findMany({ member: loner.username }, FULL_ACCESS),
	).toEqual([]);
});

test("member never widens what the actor sees: a student asking for another user's membership gets nothing of it", async () => {
	const student = await persistedUserFactory.create();
	const other = await persistedUserFactory.create();
	const hidden = await persistedCourseFactory.create();
	await db.enrollment.create(
		{ course: hidden.id, username: other.username },
		FULL_ACCESS,
	);

	const courses = await db.course.findMany(
		{ member: other.username },
		{ actor: student },
	);

	expect(courses.map((c) => c.id)).not.toContain(hidden.id);
});

//
// exam.findManyInCourses
//

const WHEN = new Date("2027-03-10T13:00:00Z");

async function examsOf(
	course: { id: schema.CourseId },
	slugs: Record<
		string,
		"DRAFT" | "SCHEDULED" | "ARCHIVED" | "ONGOING" | "COMPLETED"
	>,
) {
	for (const [slug, status] of Object.entries(slugs)) {
		await persistedExamFactory.create({
			course: course.id,
			slug,
			status,
			scheduledAt: WHEN,
		});
	}
}

test("findManyInCourses returns each exam with the id of its course, across all the given courses", async () => {
	const a = await persistedCourseFactory.create();
	const b = await persistedCourseFactory.create();
	const untouched = await persistedCourseFactory.create();
	await examsOf(a, { "a-one": "SCHEDULED", "a-two": "COMPLETED" });
	await examsOf(b, { "b-one": "ONGOING" });
	await examsOf(untouched, { "other-one": "SCHEDULED" });

	const found = await db.exam.findManyInCourses(
		{ courseIds: [a.id, b.id] },
		FULL_ACCESS,
	);

	expect(found.map((f) => [f.courseId, f.exam.slug]).sort()).toEqual(
		[
			[a.id, "a-one"],
			[a.id, "a-two"],
			[b.id, "b-one"],
		].sort(),
	);
});

test("findManyInCourses hides DRAFT and ARCHIVED exams from an enrolled student", async () => {
	const course = await persistedCourseFactory.create(
		{},
		{ transient: { students: 1 } },
	);
	const student = course.students[0];
	if (!student) throw new Error("the course has no enrolled student");
	await examsOf(course, {
		published: "SCHEDULED",
		draft: "DRAFT",
		archived: "ARCHIVED",
	});

	const found = await db.exam.findManyInCourses(
		{ courseIds: [course.id] },
		{ actor: student },
	);

	expect(found.map((f) => f.exam.slug)).toEqual(["published"]);
});

test("findManyInCourses shows drafts to the instructor of a course but hides them in a course where they only study", async () => {
	const teacher = await persistedUserFactory.create({ role: "INSTRUCTOR" });
	const taught = await persistedCourseFactory.create({
		instructor: teacher.username,
	});
	const attended = await persistedCourseFactory.create();
	await db.enrollment.create(
		{ course: attended.id, username: teacher.username },
		FULL_ACCESS,
	);
	await examsOf(taught, { "taught-draft": "DRAFT" });
	await examsOf(attended, {
		"attended-draft": "DRAFT",
		"attended-live": "SCHEDULED",
	});

	const found = await db.exam.findManyInCourses(
		{ courseIds: [taught.id, attended.id] },
		{ actor: teacher },
	);

	expect(found.map((f) => f.exam.slug).sort()).toEqual([
		"attended-live",
		"taught-draft",
	]);
});

test("findManyInCourses narrows to the requested statuses", async () => {
	const course = await persistedCourseFactory.create();
	await examsOf(course, {
		draft: "DRAFT",
		scheduled: "SCHEDULED",
		done: "COMPLETED",
		archived: "ARCHIVED",
	});

	const found = await db.exam.findManyInCourses(
		{ courseIds: [course.id], statuses: ["SCHEDULED", "ONGOING", "COMPLETED"] },
		FULL_ACCESS,
	);

	expect(found.map((f) => f.exam.slug).sort()).toEqual(["done", "scheduled"]);
});

test("findManyInCourses with no course ids returns an empty list", async () => {
	await persistedExamFactory.create();

	expect(
		await db.exam.findManyInCourses({ courseIds: [] }, FULL_ACCESS),
	).toEqual([]);
});

test("findManyInCourses skips, without error, a course whose contents the actor cannot read", async () => {
	const mine = await persistedCourseFactory.create(
		{},
		{ transient: { students: 1 } },
	);
	const student = mine.students[0];
	if (!student) throw new Error("the course has no enrolled student");
	const foreign = await persistedCourseFactory.create();
	await examsOf(mine, { "mine-live": "SCHEDULED" });
	await examsOf(foreign, { "foreign-live": "SCHEDULED" });

	const found = await db.exam.findManyInCourses(
		{ courseIds: [mine.id, foreign.id] },
		{ actor: student },
	);

	expect(found.map((f) => f.exam.slug)).toEqual(["mine-live"]);
});
