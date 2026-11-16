import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { InvalidData, NotAllowed } from "@/core/error";
import { isoDate } from "@/core/schemas";
import { db, type schema } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedQuestionFactory } from "@/fixtures/question.factory";
import { persistedUserFactory } from "@/fixtures/user.factory";

const MINUTE = 60_000;

function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
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

async function enroll(courseId: schema.CourseId) {
	const student = await persistedUserFactory.create({ role: "STUDENT" });
	await db.enrollment.create(
		{ course: courseId, username: student.username },
		FULL_ACCESS,
	);
	return student;
}

/// A course with an exam that is open and has no deadline, and two students who both have an attempt in progress.
async function setup(
	exam: { status?: "DRAFT" | "ONGOING"; duration?: { minutes: number } } = {},
) {
	const instructor = await persistedUserFactory.create({ role: "INSTRUCTOR" });
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
		edition: await ensureEdition(),
	});
	// Objective, so closing grades it; the factory's default type varies.
	const question = await persistedQuestionFactory.create(
		{ course: course.id, slug: tag("q-") },
		{ transient: { type: "multiple-choice" } },
	);
	const ada = await enroll(course.id);
	const bob = await enroll(course.id);
	const created = await persistedExamFactory.create({
		course: course.id,
		slug: tag("exam-"),
		type: "EXAM",
		status: "ONGOING",
		duration: exam.duration,
		questions: [{ slug: question.slug }],
	});
	const answer = (actor: typeof ada) =>
		db.response.submit(
			{
				course: course.id,
				exam: created.slug,
				question: question.slug,
				payload: null,
			},
			{ actor },
		);
	await answer(ada);
	await answer(bob);
	if (exam.status === "DRAFT") {
		await prisma.exam.update({
			where: { id: created.id },
			data: { status: "DRAFT" },
		});
	}
	const pk = { course: course.id, slug: created.slug };
	return { instructor, course, question, ada, bob, exam: created, pk, answer };
}

type World = Awaited<ReturnType<typeof setup>>;

/// The real attempt of `username` at the exam of `world`.
function attemptOf(world: World, username: string) {
	return prisma.response.findFirstOrThrow({
		where: { authorId: username, examId: world.exam.id, preview: false },
		include: { submissions: true },
	});
}

test("close completes the exam and closes every attempt in progress", async () => {
	const world = await setup();

	const closed = await db.exam.close(world.pk, { actor: world.instructor });

	expect(closed.status).toBe("COMPLETED");
	for (const student of [world.ada, world.bob]) {
		const attempt = await attemptOf(world, student.username);
		expect(attempt.acceptingSubmissions).toBe(false);
		expect(attempt.closedAt).not.toBeNull();
		// What was saved counts, and an objective answer is graded as at a normal close.
		expect(attempt.submissions).toHaveLength(1);
		expect(attempt.submissions[0]?.status).toBe("GRADED_AUTOMATICALLY");
	}
});

test("close does nothing on an exam that is already completed", async () => {
	const world = await setup();
	await db.exam.close(world.pk, { actor: world.instructor });
	const before = await attemptOf(world, world.ada.username);

	const again = await db.exam.close(world.pk, { actor: world.instructor });

	expect(again.status).toBe("COMPLETED");
	const after = await attemptOf(world, world.ada.username);
	expect(after.closedAt).toEqual(before.closedAt);
	expect(after.updatedAt).toEqual(before.updatedAt);
});

test("close leaves the instructor's simulation open", async () => {
	const world = await setup();
	const preview = await db.response.restartPreview(
		{ course: world.course.id, exam: world.exam.slug },
		{ actor: world.instructor },
	);

	await db.exam.close(world.pk, { actor: world.instructor });

	const row = await prisma.response.findUniqueOrThrow({
		where: { publicId: preview.publicId },
	});
	expect(row.acceptingSubmissions).toBe(true);
	expect(row.closedAt).toBeNull();
});

test("close keeps open the attempt of a student whose makeup window is still open", async () => {
	const world = await setup({ duration: { minutes: 120 } });
	await db.examException.create(
		{
			course: world.course.id,
			exam: world.exam.slug,
			username: world.bob.username,
			extraTime: null,
			scheduledAt: new Date(Date.now() - 10 * MINUTE),
		},
		FULL_ACCESS,
	);

	await db.exam.close(world.pk, { actor: world.instructor });

	const ada = await attemptOf(world, world.ada.username);
	const bob = await attemptOf(world, world.bob.username);
	expect(ada.acceptingSubmissions).toBe(false);
	expect(bob.acceptingSubmissions).toBe(true);
	expect(bob.closedAt).toBeNull();
	// Inside the personal window he can still answer.
	await world.answer(world.bob);
	await expect(world.answer(world.ada)).rejects.toBeInstanceOf(InvalidData);
});

test("close closes the attempt of a student whose makeup window already ended", async () => {
	const world = await setup({ duration: { minutes: 30 } });
	await db.examException.create(
		{
			course: world.course.id,
			exam: world.exam.slug,
			username: world.bob.username,
			extraTime: null,
			scheduledAt: new Date(Date.now() - 120 * MINUTE),
		},
		FULL_ACCESS,
	);

	await db.exam.close(world.pk, { actor: world.instructor });

	const bob = await attemptOf(world, world.bob.username);
	expect(bob.acceptingSubmissions).toBe(false);
});

test("updating the status to COMPLETED closes the attempts as close does", async () => {
	const world = await setup();

	await db.exam.update(
		world.pk,
		{ status: "COMPLETED" },
		{ actor: world.instructor },
	);

	const attempt = await attemptOf(world, world.ada.username);
	expect(attempt.acceptingSubmissions).toBe(false);
	expect(attempt.submissions[0]?.status).toBe("GRADED_AUTOMATICALLY");
});

test("updating other fields leaves the attempts open", async () => {
	const world = await setup();

	await db.exam.update(
		world.pk,
		{ title: "Another title" },
		{ actor: world.instructor },
	);

	const attempt = await attemptOf(world, world.ada.username);
	expect(attempt.acceptingSubmissions).toBe(true);
});

test("a student cannot close the exam", async () => {
	const world = await setup();

	const attempt = db.exam.close(world.pk, { actor: world.ada });

	await expect(attempt).rejects.toBeInstanceOf(NotAllowed);
	expect(
		(await attemptOf(world, world.ada.username)).acceptingSubmissions,
	).toBe(true);
});

test("close refuses an exam that was never published", async () => {
	const world = await setup({ status: "DRAFT" });

	await expect(
		db.exam.close(world.pk, { actor: world.instructor }),
	).rejects.toBeInstanceOf(InvalidData);
});
