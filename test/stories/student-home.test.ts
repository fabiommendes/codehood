import { expect, type Page, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCalendarEventFactory } from "@/fixtures/calendar-event.factory";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedTimeSlotFactory } from "@/fixtures/time-slot.factory";
import { capitalChoice } from "@/mdq/fixtures";
import { courseHref } from "@/urls";
import { logInAs, resetDatabase, seedUser } from "./helpers";

test.beforeEach(resetDatabase);

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

type Course = Awaited<ReturnType<typeof persistedCourseFactory.create>>;

test("student: see what needs my attention", async ({ page }) => {
	const busy = await seedUser({ role: "STUDENT", username: "busy-student" });
	const quiet = await seedUser({ role: "STUDENT", username: "quiet-student" });
	const idle = await seedUser({ role: "STUDENT", username: "idle-student" });

	const algebra = await persistedCourseFactory.create();
	const compilers = await persistedCourseFactory.create();
	const foreign = await persistedCourseFactory.create();
	const sparse = await persistedCourseFactory.create();
	const empty = await persistedCourseFactory.create();
	await enroll(algebra, busy.username);
	await enroll(compilers, busy.username);
	await enroll(sparse, quiet.username);
	await enroll(empty, idle.username);

	const now = Date.now();

	// What the busy student has to do.
	await persistedExamFactory.create({
		course: algebra.id,
		slug: "open-midterm",
		title: "Open midterm",
		type: "EXAM",
		status: "SCHEDULED",
		scheduledAt: new Date(now - 10 * MINUTE),
		duration: { minutes: 60 },
	});
	const takeHome = await persistedExamFactory.create({
		course: compilers.id,
		slug: "take-home",
		title: "Take-home",
		type: "EXAM",
		status: "ONGOING",
		duration: { minutes: 30 },
	});
	await db.response.create(
		{ course: compilers.id, exam: takeHome.slug, author: busy.username },
		FULL_ACCESS,
	);
	await persistedExamFactory.create({
		course: algebra.id,
		slug: "final-exam",
		title: "Final exam",
		type: "EXAM",
		status: "SCHEDULED",
		scheduledAt: new Date(now + 2 * DAY),
		duration: { hours: 2 },
	});
	await scheduleEvent(algebra, "Algebra lecture", new Date(now));
	await releasedExam(compilers, busy.username, "Recap", "3/4");

	// Nothing of this may reach the busy student: they are not in this course.
	await persistedExamFactory.create({
		course: foreign.id,
		slug: "foreign-open",
		title: "Foreign open exam",
		type: "EXAM",
		status: "SCHEDULED",
		scheduledAt: new Date(now - 10 * MINUTE),
		duration: { minutes: 60 },
	});
	await scheduleEvent(foreign, "Foreign lecture", new Date(now));

	// The quiet student has only something far away.
	await scheduleEvent(sparse, "Distant workshop", new Date(now + 20 * DAY));

	await logInAs(page, busy);

	await test.step("the signed-in root is the home page, not a redirect", async () => {
		await page.goto("/");

		await expect(page).toHaveURL("/");
		for (const heading of ["Open now", "Coming up", "Today", "New results"]) {
			await expect(
				page.getByRole("heading", { name: heading, exact: true }),
			).toBeVisible();
		}
		await expect(page.getByText("Nothing needs you right now")).toHaveCount(0);
	});

	await test.step("an exam not yet started links to its page and invites the student to start", async () => {
		const open = section(page, "Open now");

		const link = open.getByRole("link", { name: /Open midterm/ });
		await expect(link).toHaveAttribute(
			"href",
			`${hrefOf(algebra)}/exams/open-midterm`,
		);
		await expect(open).toContainText(algebra.discipline.slug);
		await expect(open).toContainText(/start/i);
	});

	await test.step("an exam in progress shows the time left", async () => {
		const open = section(page, "Open now");

		await expect(open.getByRole("link", { name: /Take-home/ })).toHaveAttribute(
			"href",
			`${hrefOf(compilers)}/exams/take-home`,
		);
		await expect(open).toContainText(compilers.discipline.slug);
		await expect(open).toContainText(/left/);
	});

	await test.step("an upcoming exam shows its course and when it opens", async () => {
		const coming = section(page, "Coming up");

		await expect(
			coming.getByRole("link", { name: /Final exam/ }),
		).toHaveAttribute("href", `${hrefOf(algebra)}/exams/final-exam`);
		await expect(coming).toContainText(algebra.discipline.slug);
		await expect(coming).toContainText(/opens/i);
	});

	await test.step("today's meeting is listed with its course", async () => {
		const today = section(page, "Today");

		await expect(today).toContainText("Algebra lecture");
		await expect(today).toContainText(algebra.discipline.slug);
	});

	await test.step("a freshly released result shows its percentage, linking to the exam", async () => {
		const results = section(page, "New results");

		await expect(results.getByRole("link", { name: /Recap/ })).toHaveAttribute(
			"href",
			`${hrefOf(compilers)}/exams/recap`,
		);
		await expect(results).toContainText("75%");
		await expect(results).toContainText(compilers.discipline.slug);
	});

	await test.step("nothing from a course the student is not in shows up", async () => {
		await expect(page.getByText("Foreign open exam")).toHaveCount(0);
		await expect(page.getByText("Foreign lecture")).toHaveCount(0);
		await expect(page.getByText(foreign.discipline.slug)).toHaveCount(0);
	});

	await test.step("the sidebar marks Home as the current page", async () => {
		await expect(
			page.getByRole("link", { name: "Home", exact: true }),
		).toHaveAttribute("aria-current", "page");
	});

	await test.step("the course list is still at /courses", async () => {
		await page.goto("/courses");

		await expect(
			page.getByRole("heading", { name: algebra.discipline.name }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", { name: compilers.discipline.name }),
		).toBeVisible();
	});

	await test.step("on a quiet week the page says so and shows the next thing, however far", async () => {
		await page.context().clearCookies();
		await logInAs(page, quiet);
		await page.goto("/");

		await expect(page.getByText("Nothing needs you right now")).toBeVisible();
		await expect(page.getByText("Distant workshop")).toBeVisible();
		await expect(page.getByText(sparse.discipline.slug).first()).toBeVisible();
		for (const heading of ["Open now", "Coming up", "Today", "New results"]) {
			await expect(
				page.getByRole("heading", { name: heading, exact: true }),
			).toHaveCount(0);
		}
	});

	await test.step("with nothing ahead at all, only the quiet message remains", async () => {
		await page.context().clearCookies();
		await logInAs(page, idle);
		await page.goto("/");

		await expect(page.getByText("Nothing needs you right now")).toBeVisible();
		await expect(page.getByText("Distant workshop")).toHaveCount(0);
		for (const heading of ["Open now", "Coming up", "Today", "New results"]) {
			await expect(
				page.getByRole("heading", { name: heading, exact: true }),
			).toHaveCount(0);
		}
	});

	await test.step("signed out, the root is still the landing page", async () => {
		await page.context().clearCookies();
		await page.goto("/");

		await expect(
			page.getByRole("heading", {
				level: 1,
				name: "Run your course like a Git repo.",
			}),
		).toBeVisible();
		await expect(page.getByText("Nothing needs you right now")).toHaveCount(0);
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

/// A calendar event of `course` starting at `startAt`, whichever slot and week it hangs from.
async function scheduleEvent(course: Course, title: string, startAt: Date) {
	const slot = await persistedTimeSlotFactory.create({ course: course.id });
	const created = await persistedCalendarEventFactory.create({
		course: course.id,
		timeSlot: slot.id,
		week: 1,
		title,
	});
	await prisma.calendarEvent.update({
		where: { id: created.id },
		data: { startAt },
	});
}

/// An exam the student sat, that was graded `score` on its one question and released yesterday.
async function releasedExam(
	course: Course,
	username: string,
	title: string,
	score: string,
) {
	const slug = title.toLowerCase();
	const question = await db.question.create(
		{
			course: course.id,
			slug: `${slug}-q`,
			status: "PUBLISHED",
			version: "1",
			question: capitalChoice,
		},
		FULL_ACCESS,
	);
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug,
		title,
		type: "EXAM",
		status: "ONGOING",
		questions: [{ slug: question.slug }],
	});
	const response = await db.response.submit(
		{
			course: course.id,
			exam: slug,
			question: question.slug,
			payload: { choice: "brasilia" },
			author: username,
		},
		FULL_ACCESS,
	);
	await db.response.finish(
		{ course: course.id, exam: slug, author: username },
		FULL_ACCESS,
	);
	await prisma.exam.update({
		where: { id: exam.id },
		data: {
			status: "COMPLETED",
			gradesReleasedAt: new Date(Date.now() - DAY),
		},
	});
	await db.feedback.create(
		{
			submission: {
				publicId: response.submissions.at(-1)?.publicId ?? "",
			},
			ref: "pass-1",
			score,
			grader: course.instructor.username,
		},
		FULL_ACCESS,
	);
}
