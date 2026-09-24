import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { type Course, db } from "@/db";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { courseHref } from "@/urls";
import { logInAs, resetDatabase, seedUser } from "./helpers";

test.beforeEach(resetDatabase);

test("student: see the exams assigned to me", async ({ page }) => {
	const student = await seedUser({ role: "STUDENT", username: "exam-student" });
	const course = await persistedCourseFactory.create();
	await enroll(course.id, student.username);

	const now = Date.now();
	const DAY = 86_400_000;

	const open = await persistedExamFactory.create({
		course: course.id,
		slug: "open-exam",
		title: "Ongoing midterm",
		type: "EXAM",
		status: "ONGOING",
		scheduledAt: new Date(now - DAY),
		duration: { minutes: 60 },
	});
	const practice = await persistedExamFactory.create({
		course: course.id,
		slug: "practice-quiz",
		title: "Practice quiz",
		type: "PRACTICE",
		status: "SCHEDULED",
		scheduledAt: new Date(now + 2 * DAY),
		duration: { minutes: 30 },
	});
	const upcoming = await persistedExamFactory.create({
		course: course.id,
		slug: "upcoming-final",
		title: "Upcoming final",
		type: "EXAM",
		status: "SCHEDULED",
		scheduledAt: new Date(now + 10 * DAY),
		duration: { minutes: 120 },
	});
	const past = await persistedExamFactory.create({
		course: course.id,
		slug: "past-quiz",
		title: "Completed quiz",
		type: "QUIZ",
		status: "COMPLETED",
		scheduledAt: new Date(now - 10 * DAY),
		duration: { minutes: 30 },
	});
	const draft = await persistedExamFactory.create({
		course: course.id,
		slug: "draft-exam",
		title: "Draft exam nobody should see",
		type: "EXAM",
		status: "DRAFT",
	});

	await logInAs(page, student);

	await test.step("the exams page shows the four sections with the right exams, no draft, and no table", async () => {
		await page.goto(`${hrefOf(course)}/exams`);

		await expect(section(page, "Open").getByText(open.title)).toBeVisible();
		await expect(
			section(page, "Practice").getByText(practice.title),
		).toBeVisible();
		await expect(
			section(page, "Upcoming").getByText(upcoming.title),
		).toBeVisible();
		await expect(
			section(page, "Past exams and grades").getByText(past.title),
		).toBeVisible();

		await expect(page.getByText(draft.title)).toHaveCount(0);
		await expect(page.getByRole("table")).toHaveCount(0);
	});

	await test.step("the course home page lists the upcoming exam under Upcoming exams", async () => {
		await page.goto(hrefOf(course));

		await expect(
			page.getByRole("heading", { name: "Upcoming exams", exact: true }),
		).toBeVisible();
		await expect(page.getByText(upcoming.title)).toBeVisible();
	});

	await test.step("a course with only practice exams falls back to the Practice heading", async () => {
		const practiceOnlyCourse = await persistedCourseFactory.create();
		await enroll(practiceOnlyCourse.id, student.username);
		const drill = await persistedExamFactory.create({
			course: practiceOnlyCourse.id,
			slug: "drill",
			title: "Practice drill",
			type: "PRACTICE",
			status: "SCHEDULED",
		});

		await page.goto(hrefOf(practiceOnlyCourse));

		await expect(
			page.getByRole("heading", { name: "Practice", exact: true }),
		).toBeVisible();
		await expect(page.getByText(drill.title)).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "Upcoming exams", exact: true }),
		).toHaveCount(0);
	});

	await test.step("a course with no exams at all omits the section entirely", async () => {
		const examlessCourse = await persistedCourseFactory.create();
		await enroll(examlessCourse.id, student.username);

		await page.goto(hrefOf(examlessCourse));

		await expect(
			page.getByRole("heading", { name: "Upcoming exams", exact: true }),
		).toHaveCount(0);
		await expect(
			page.getByRole("heading", { name: "Practice", exact: true }),
		).toHaveCount(0);
	});
});

//
// Utilities
//

/** Enrolls an already-seeded student, which the course factory's `students` cannot do. */
async function enroll(courseId: Course["id"], username: string) {
	await db.enrollment.create(
		{ course: courseId, username: username },
		FULL_ACCESS,
	);
}

/** The course's public URL, from the three columns of its unique key. */
function hrefOf(
	course: Awaited<ReturnType<typeof persistedCourseFactory.create>>,
) {
	return courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});
}

/**
 * Scopes assertions to one exam section: the `<section>` wrapping the
 * heading named `title`, the same convention the course home page already
 * uses for "Upcoming exams", "Resources" and "Schedule".
 */
function section(page: import("@playwright/test").Page, title: string) {
	return page.locator("section").filter({
		has: page.getByRole("heading", { name: title, exact: true }),
	});
}
