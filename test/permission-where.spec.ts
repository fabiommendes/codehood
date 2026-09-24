import { expect, test } from "@playwright/test";
import { type Actor, FULL_ACCESS, SYSTEM } from "@/auth/actor";
import {
	type CourseWithEnrollment,
	hasPerm,
	type QuestionWithCourse,
} from "@/auth/permissions";
import { db, type User } from "@/db";
import { prisma } from "@/db/client";
import { courseContentsWhere, courseWhere } from "@/db/services/course.service";
import { questionWhere } from "@/db/services/question.service";
import { userWhere } from "@/db/services/user.service";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { questionFactory } from "@/fixtures/question.factory";
import { persistedUserFactory } from "@/fixtures/user.factory";

/// A visibility rule, as a pair: the `where` fragment and the predicate it must agree with.
interface Pair<Row> {
	/// Ids the fragment selects, restricted to the fixtures this test created.
	select(actor: Actor): Promise<number[]>;
	/// Fixtures, each paired with the target its predicate takes.
	rows: { id: number; target: Row }[];
	/// Whether the predicate accepts `target`.
	accepts(actor: Actor, target: Row): boolean;
}

/// Asserts the fragment selects exactly the rows the predicate accepts, for every actor.
async function expectAgreement<Row>(
	pair: Pair<Row>,
	actors: { label: string; actor: Actor }[],
): Promise<void> {
	for (const { label, actor } of actors) {
		const selected = await pair.select(actor);
		const accepted = pair.rows
			.filter(({ target }) => pair.accepts(actor, target))
			.map(({ id }) => id);
		expect(selected.sort(), label).toEqual(accepted.sort());
	}
}

function actorOf(user: User): Actor {
	return { username: user.username, name: user.name, role: user.role };
}

// -----------------------------------------------------------------------------
// userWhere

test("userWhere selects exactly the rows user.read accepts", async () => {
	const admin = await persistedUserFactory.create({ role: "ADMIN" });
	const instructor = await persistedUserFactory.create({ role: "INSTRUCTOR" });
	const student = await persistedUserFactory.create({ role: "STUDENT" });
	const fixtures = [admin, instructor, student];
	const usernames = fixtures.map((u) => u.username);

	const actors: { label: string; actor: Actor }[] = [
		{ label: "SYSTEM", actor: SYSTEM },
		{ label: "admin", actor: actorOf(admin) },
		{ label: "instructor", actor: actorOf(instructor) },
		{ label: "student", actor: actorOf(student) },
	];
	for (const { label, actor } of actors) {
		const rows = await prisma.user.findMany({
			where: { AND: [{ username: { in: usernames } }, userWhere(actor)] },
			select: { username: true },
		});
		const accepted = fixtures
			.filter((u) => hasPerm(actor, "user.read", u))
			.map((u) => u.username);
		expect(rows.map((r) => r.username).sort(), label).toEqual(accepted.sort());
	}

	// A student must not see the other two, whichever side is asked.
	const studentActor = actorOf(student);
	expect(
		await db.user.findMany({ usernames }, { actor: studentActor }),
	).toHaveLength(1);
});

// -----------------------------------------------------------------------------
// courseWhere / courseContentsWhere

// The discipline and edition factories draw slugs from a short sequence that
// collides with the ones sibling spec files draw, so this file provisions both
// by hand.
function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

/// Edition slugs are constrained to `YYYY[-N]`, so this file claims one of its own.
const EDITION = "7431-1";

async function freshCourseScope() {
	if (!(await db.edition.findOne({ slug: EDITION }, FULL_ACCESS))) {
		await db.edition.create(
			{
				slug: EDITION,
				name: EDITION,
				startAt: new Date("2026-01-01"),
				endAt: new Date("2030-12-31"),
			},
			FULL_ACCESS,
		);
	}
	const discipline = tag("pwdisc");
	await db.discipline.create(
		{ slug: discipline, name: discipline },
		FULL_ACCESS,
	);
	return { discipline, edition: EDITION };
}

/// A course taught by a fresh instructor, with one ACTIVE and one DROPPED enrollment.
async function courseWithDroppedStudent() {
	const instructor = await persistedUserFactory.create({ role: "INSTRUCTOR" });
	const course = await persistedCourseFactory.create(
		{ instructor: instructor.username, ...(await freshCourseScope()) },
		{ transient: { students: 2 } },
	);
	const [active, dropped] = course.students as [User, User];
	await db.enrollment.delete(
		{ course: course.id, username: dropped.username },
		FULL_ACCESS,
	);
	return { instructor, course, active, dropped };
}

test("courseWhere and courseContentsWhere select exactly the rows course.read accepts, and a DROPPED student is not one of them", async () => {
	const { instructor, course, active, dropped } =
		await courseWithDroppedStudent();
	const outsiderInstructor = await persistedUserFactory.create({
		role: "INSTRUCTOR",
	});
	const foreign = await persistedCourseFactory.create({
		instructor: outsiderInstructor.username,
		...(await freshCourseScope()),
	});
	const admin = await persistedUserFactory.create({ role: "ADMIN" });
	const outsider = await persistedUserFactory.create({ role: "STUDENT" });

	// Targets are built from what the fixtures did, not from what the service
	// loads: a fragment and an `include` that drop the same filter would
	// otherwise agree with each other and still be wrong.
	const rows: { id: number; target: CourseWithEnrollment }[] = [
		{
			id: course.id,
			target: {
				id: course.id,
				instructor: { username: instructor.username },
				enrollments: [{ username: active.username }],
			},
		},
		{
			id: foreign.id,
			target: {
				id: foreign.id,
				instructor: { username: outsiderInstructor.username },
				enrollments: [],
			},
		},
	];
	const ids = rows.map((r) => r.id);

	const actors: { label: string; actor: Actor }[] = [
		{ label: "SYSTEM", actor: SYSTEM },
		{ label: "admin", actor: actorOf(admin) },
		{ label: "instructor", actor: actorOf(instructor) },
		{ label: "foreign instructor", actor: actorOf(outsiderInstructor) },
		{ label: "active student", actor: actorOf(active) },
		{ label: "dropped student", actor: actorOf(dropped) },
		{ label: "outsider student", actor: actorOf(outsider) },
	];

	const select = (where: (actor: Actor) => object) => async (actor: Actor) => {
		const found = await prisma.course.findMany({
			where: { AND: [{ id: { in: ids } }, where(actor)] },
			select: { id: true },
		});
		return found.map((c) => c.id);
	};

	await expectAgreement(
		{
			select: select(courseWhere),
			rows,
			accepts: (actor, target) => hasPerm(actor, "course.read", target),
		},
		actors,
	);
	await expectAgreement(
		{
			select: select(courseContentsWhere),
			rows,
			accepts: (actor, target) =>
				hasPerm(actor, "course.read-contents", target),
		},
		actors,
	);

	// The case the agreement above exists for, stated on its own.
	expect(await select(courseWhere)(actorOf(dropped))).toEqual([]);
	expect(await select(courseWhere)(actorOf(active))).toEqual([course.id]);
});

// -----------------------------------------------------------------------------
// questionWhere

test("questionWhere selects exactly the rows question.read and question.read-public accept", async () => {
	const { instructor, course, active, dropped } =
		await courseWithDroppedStudent();
	const admin = await persistedUserFactory.create({ role: "ADMIN" });
	const instructorActor = actorOf(instructor);

	const courseTarget: CourseWithEnrollment = {
		id: course.id,
		instructor: { username: instructor.username },
		enrollments: [{ username: active.username }],
	};

	const statuses = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
	const rows: { id: number; target: QuestionWithCourse }[] = [];
	for (const status of statuses) {
		const input = questionFactory.build({
			course: course.id,
			slug: `where-${status.toLowerCase()}`,
		});
		const question = await db.question.create(
			{ ...input, status },
			{ actor: instructorActor },
		);
		rows.push({
			id: question.id,
			target: { id: question.id, status, course: courseTarget },
		});
	}
	const ids = rows.map((r) => r.id);

	const actors: { label: string; actor: Actor }[] = [
		{ label: "SYSTEM", actor: SYSTEM },
		{ label: "admin", actor: actorOf(admin) },
		{ label: "instructor", actor: instructorActor },
		{ label: "active student", actor: actorOf(active) },
		{ label: "dropped student", actor: actorOf(dropped) },
	];

	const select = (isPublic: boolean) => async (actor: Actor) => {
		const found = await prisma.questionRef.findMany({
			where: { AND: [{ id: { in: ids } }, questionWhere(actor, isPublic)] },
			select: { id: true },
		});
		return found.map((q) => q.id);
	};

	await expectAgreement(
		{
			select: select(false),
			rows,
			accepts: (actor, target) => hasPerm(actor, "question.read", target),
		},
		actors,
	);
	await expectAgreement(
		{
			select: select(true),
			rows,
			accepts: (actor, target) =>
				hasPerm(actor, "question.read-public", target),
		},
		actors,
	);

	// The two rows the public fragment exists to separate.
	const published = rows.find((r) => r.target.status === "PUBLISHED");
	expect(await select(true)(actorOf(active))).toEqual([published?.id]);
	expect(await select(true)(actorOf(dropped))).toEqual([]);
});
