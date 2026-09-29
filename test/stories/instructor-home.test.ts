import { expect, type Page, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db, type schema } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { brasiliaFillIn, capitalChoice } from "@/mdq/fixtures";
import { courseHref } from "@/urls";
import { logInAs, resetDatabase, seedUser } from "./helpers";

test.beforeEach(resetDatabase);

const MINUTE = 60_000;

type Course = Awaited<ReturnType<typeof persistedCourseFactory.create>>;
type Student = Awaited<ReturnType<typeof seedUser>>;

test("instructor: see what needs my attention", async ({ page }) => {
	const teacher = await seedUser({ role: "INSTRUCTOR", username: "teacher" });
	const other = await seedUser({ role: "INSTRUCTOR", username: "colleague" });
	const idleTeacher = await seedUser({
		role: "INSTRUCTOR",
		username: "idle-teacher",
	});

	const algebra = await persistedCourseFactory.create({
		instructor: teacher.username,
	});
	const compilers = await persistedCourseFactory.create({
		instructor: teacher.username,
	});
	// The instructor sits this one as a student.
	const seminar = await persistedCourseFactory.create({
		instructor: other.username,
	});

	const algebraStudents: Student[] = [];
	for (let i = 1; i <= 5; i++) {
		const s = await seedUser({ role: "STUDENT", username: `alg-student-${i}` });
		await enroll(algebra, s.username);
		algebraStudents.push(s);
	}
	const finalist = await seedUser({ role: "STUDENT", username: "finalist" });
	await enroll(compilers, finalist.username);
	await enroll(seminar, teacher.username);

	const algebraQuestion = await question(algebra, "alg-q");
	const compilersQuestion = await question(compilers, "cmp-q");

	// In progress: 5 enrolled, 3 submitted, 1 still answering, 1 not started.
	const midterm = await persistedExamFactory.create({
		course: algebra.id,
		slug: "midterm",
		title: "Midterm",
		type: "EXAM",
		status: "SCHEDULED",
		scheduledAt: new Date(Date.now() - 10 * MINUTE),
		duration: { minutes: 60 },
		questions: [{ slug: algebraQuestion }],
	});
	for (const [i, s] of algebraStudents.slice(0, 4).entries()) {
		await answer(algebra, midterm.slug, algebraQuestion, s, i < 3);
	}

	// To grade: two students submitted, nobody has graded.
	const written = await persistedExamFactory.create({
		course: algebra.id,
		slug: "written",
		title: "Written exam",
		type: "EXAM",
		status: "ONGOING",
		questions: [{ slug: algebraQuestion }],
	});
	for (const s of algebraStudents.slice(0, 2)) {
		await answer(algebra, written.slug, algebraQuestion, s, true);
	}
	await prisma.exam.update({
		where: { id: written.id },
		data: { status: "COMPLETED" },
	});

	// Ready to release: closed, one attempt, fully graded.
	const final = await persistedExamFactory.create({
		course: compilers.id,
		slug: "final",
		title: "Final",
		type: "EXAM",
		status: "ONGOING",
		questions: [{ slug: compilersQuestion }],
	});
	const submission = await answer(
		compilers,
		final.slug,
		compilersQuestion,
		finalist,
		true,
	);
	await db.feedback.create(
		{
			submission: { publicId: submission },
			ref: "pass-1",
			score: "1",
			grader: teacher.username,
		},
		FULL_ACCESS,
	);
	await prisma.exam.update({
		where: { id: final.id },
		data: { status: "COMPLETED" },
	});

	// Question problems: one question of the compilers course fails validation.
	await brokenQuestion(compilers, "broken-blanks");

	// As a student of the seminar, the instructor has an exam to start.
	await persistedExamFactory.create({
		course: seminar.id,
		slug: "peer-review",
		title: "Peer review",
		type: "EXAM",
		status: "SCHEDULED",
		scheduledAt: new Date(Date.now() - 10 * MINUTE),
		duration: { minutes: 60 },
	});

	await logInAs(page, teacher);

	await test.step("the home page leads with what needs the instructor, section by section", async () => {
		await page.goto("/");

		await expect(page).toHaveURL("/");
		for (const heading of [
			"In progress",
			"To grade",
			"Ready to release",
			"Question problems",
		]) {
			await expect(
				page.getByRole("heading", { name: heading, exact: true }),
			).toBeVisible();
		}
		await expect(page.getByText("Nothing needs you right now")).toHaveCount(0);
	});

	await test.step("in progress shows how many students submitted, with the course", async () => {
		const inProgress = section(page, "In progress");

		await expect(inProgress).toContainText("Midterm");
		await expect(inProgress).toContainText(algebra.discipline.slug);
		await expect(inProgress).toContainText("3 of 5 submitted");
	});

	await test.step("to grade shows how many answers wait for a verdict", async () => {
		const toGrade = section(page, "To grade");

		await expect(toGrade).toContainText("Written exam");
		await expect(toGrade).toContainText("2 answers to grade");
		// The midterm's three closed attempts wait for grading too.
		await expect(toGrade).toContainText("3 answers to grade");
		await expect(toGrade).toContainText(algebra.discipline.slug);
	});

	await test.step("ready to release lists the fully graded, closed exam and nothing with pending answers", async () => {
		const ready = section(page, "Ready to release");

		await expect(ready).toContainText("Final");
		await expect(ready).toContainText(compilers.discipline.slug);
		await expect(ready).not.toContainText("Written exam");
		await expect(ready).not.toContainText("Midterm");
	});

	await test.step("question problems name the course and the count", async () => {
		const problems = section(page, "Question problems");

		await expect(problems).toContainText(compilers.discipline.slug);
		await expect(problems).toContainText("1 question with problems");
		await expect(problems).not.toContainText(algebra.discipline.slug);
	});

	await test.step("the courses the instructor takes as a student appear below, marked with their course", async () => {
		const open = section(page, "Open now");

		await expect(open).toContainText("Peer review");
		await expect(open).toContainText(seminar.discipline.slug);

		const problems = await page
			.getByRole("heading", { name: "Question problems", exact: true })
			.boundingBox();
		const student = await page
			.getByRole("heading", { name: "Open now", exact: true })
			.boundingBox();
		expect(problems?.y).toBeLessThan(student?.y ?? 0);
	});

	await test.step("each item links to the page where the instructor deals with it", async () => {
		const exam = (course: Course, slug: string) =>
			`${hrefOf(course)}/exams/${slug}`;

		await expect(
			section(page, "In progress").getByRole("link", { name: /Midterm/ }),
		).toHaveAttribute("href", exam(algebra, "midterm"));
		await expect(
			section(page, "To grade").getByRole("link", { name: /Written exam/ }),
		).toHaveAttribute("href", exam(algebra, "written"));
		await expect(
			section(page, "Ready to release").getByRole("link", { name: /Final/ }),
		).toHaveAttribute("href", exam(compilers, "final"));
		await expect(
			section(page, "Question problems")
				.getByRole("link")
				.filter({ hasText: compilers.discipline.slug }),
		).toHaveAttribute("href", `${hrefOf(compilers)}/questions`);
	});

	await test.step("a student never sees the release button", async () => {
		await page.context().clearCookies();
		await logInAs(page, finalist);
		await page.goto(`${hrefOf(compilers)}/exams/${final.slug}`);

		await expect(
			page.getByRole("button", { name: "Release results" }),
		).toHaveCount(0);
	});

	await test.step("the instructor sees Release results only where nothing is pending", async () => {
		await page.context().clearCookies();
		await logInAs(page, teacher);

		await page.goto(`${hrefOf(algebra)}/exams/${written.slug}`);
		await expect(
			page.getByRole("button", { name: "Release results" }),
		).toHaveCount(0);

		await page.goto(`${hrefOf(compilers)}/exams/${final.slug}`);
		await expect(
			page.getByRole("button", { name: "Release results" }),
		).toBeVisible();
	});

	await test.step("cancelling the confirmation releases nothing", async () => {
		await page.getByRole("button", { name: "Release results" }).click();

		const dialog = page.getByRole("dialog");
		await expect(dialog).toContainText(/students/i);
		await dialog.getByRole("button", { name: "Cancel" }).click();

		await expect(dialog).toBeHidden();
		await expect(
			page.getByRole("button", { name: "Release results" }),
		).toBeVisible();
		expect(await releasedAt(final.id)).toBeNull();
	});

	await test.step("confirming releases the grades and removes the button", async () => {
		await page.getByRole("button", { name: "Release results" }).click();
		await page
			.getByRole("dialog")
			.getByRole("button", { name: "Release results" })
			.click();

		await expect(page.getByText(/Released/).first()).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Release results" }),
		).toHaveCount(0);
		expect(await releasedAt(final.id)).not.toBeNull();
	});

	await test.step("a released exam no longer needs releasing", async () => {
		await page.goto("/");

		await expect(
			page.getByRole("heading", { name: "Ready to release", exact: true }),
		).toHaveCount(0);
		await expect(
			page.getByRole("heading", { name: "To grade", exact: true }),
		).toBeVisible();
	});

	await test.step("an instructor with nothing to do is told so", async () => {
		await page.context().clearCookies();
		await logInAs(page, idleTeacher);
		await page.goto("/");

		await expect(page.getByText("Nothing needs you right now")).toBeVisible();
		for (const heading of [
			"In progress",
			"To grade",
			"Ready to release",
			"Question problems",
		]) {
			await expect(
				page.getByRole("heading", { name: heading, exact: true }),
			).toHaveCount(0);
		}
	});
});

//
// Utilities
//

async function enroll(course: Course, username: string) {
	await db.enrollment.create({ course: course.id, username }, FULL_ACCESS);
}

function hrefOf(course: Course) {
	return courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});
}

/// The `<section>` wrapping the heading `title`.
function section(page: Page, title: string) {
	return page.locator("section").filter({
		has: page.getByRole("heading", { name: title, exact: true }),
	});
}

async function question(course: Course, slug: string): Promise<string> {
	await db.question.create(
		{
			course: course.id,
			slug,
			status: "PUBLISHED",
			version: "1",
			question: capitalChoice,
		},
		FULL_ACCESS,
	);
	return slug;
}

/// Answers `questionSlug` as `student`, closing the attempt when `finish` is set; returns the submission's publicId.
async function answer(
	course: Course,
	exam: string,
	questionSlug: string,
	student: Student,
	finish: boolean,
): Promise<string> {
	const response = await db.response.submit(
		{
			course: course.id,
			exam,
			question: questionSlug,
			payload: { choice: "brasilia" },
		},
		{ actor: student },
	);
	if (finish) {
		await db.response.finish({ course: course.id, exam }, { actor: student });
	}
	return response.submissions.at(-1)?.publicId ?? "";
}

/// A question the service accepted, then corrupted in storage so its document fails validation.
async function brokenQuestion(course: Course, slug: string) {
	await db.question.create(
		{
			course: course.id,
			slug,
			status: "PUBLISHED",
			version: "1",
			question: brasiliaFillIn,
		},
		FULL_ACCESS,
	);
	const versions = await prisma.questionData.findMany({
		where: { ref: { slug, courseId: course.id } },
	});
	for (const version of versions) {
		const broken = "A stem that references no blank at all.";
		await prisma.questionData.update({
			where: { id: version.id },
			data: {
				stem: broken,
				publicPayload: {
					...(version.publicPayload as Record<string, unknown>),
					stem: broken,
				},
			},
		});
	}
}

async function releasedAt(examId: schema.ExamId): Promise<Date | null> {
	const row = await prisma.exam.findUniqueOrThrow({ where: { id: examId } });
	return row.gradesReleasedAt;
}
