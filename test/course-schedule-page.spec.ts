import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db, type ResourceCreate } from "@/db";
import { persistedCalendarEventFactory } from "@/fixtures/calendar-event.factory";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedTimeSlotFactory } from "@/fixtures/time-slot.factory";
import { courseHref } from "@/urls";
import { fileDownloadName } from "@/utils/resource-url";
import {
	futureDate,
	logInAs,
	resetDatabase,
	seedUser,
} from "./stories/helpers";

test.beforeEach(resetDatabase);

const DAY = 86_400_000;

test("the schedule folds the weeks already held and shows the exams among the meetings", async ({
	page,
}) => {
	const student = await seedUser({ role: "STUDENT" });
	// A term that began ten weeks ago.
	const course = await persistedCourseFactory.create({
		startAt: new Date(Date.now() - 70 * DAY),
		endAt: new Date(Date.now() + 70 * DAY),
	});
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	const slot = await persistedTimeSlotFactory.create({
		course: course.id,
		day: futureDate(0).day,
	});
	const first = await persistedCalendarEventFactory.create({
		course: course.id,
		timeSlot: slot.id,
		week: 0,
		title: "First meeting",
	});
	await persistedCalendarEventFactory.create({
		course: course.id,
		timeSlot: slot.id,
		week: 1,
		title: "Second meeting",
	});
	await persistedCalendarEventFactory.create({
		course: course.id,
		timeSlot: slot.id,
		week: 12,
		title: "Meeting ahead",
		description: "- Lists\n- Dictionaries",
	});
	await persistedExamFactory.create({
		course: course.id,
		slug: "quiz-ahead",
		title: "Quiz ahead",
		type: "QUIZ",
		scheduledAt: new Date(Date.now() + 20 * DAY),
	});
	await persistedExamFactory.create({
		course: course.id,
		slug: "final-draft",
		title: "Unfinished final",
		status: "DRAFT",
		scheduledAt: new Date(Date.now() + 30 * DAY),
	});
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});

	await logInAs(page, student);
	await page.goto(`${href}/schedule`);

	await test.step("the weeks already held are folded under one line", async () => {
		await expect(page.getByText("Weeks 0–1, already held")).toBeVisible();
		await expect(page.getByText("First meeting")).toBeHidden();
	});

	await test.step("the next meeting is marked and shows its lesson plan", async () => {
		const row = page.locator("li", { hasText: "Meeting ahead" });
		await expect(row.getByText("Next", { exact: true })).toBeVisible();
		await expect(row.getByRole("listitem")).toHaveText([
			"Lists",
			"Dictionaries",
		]);
	});

	await test.step("a dated exam sits in its week and leads to its page", async () => {
		const link = page.getByRole("link", { name: "Quiz ahead" });
		await expect(link).toHaveAttribute("href", `${href}/exams/quiz-ahead`);
		await expect(page.locator("#exam-quiz-ahead")).toContainText("Quiz");
	});

	await test.step("a student never sees a draft", async () => {
		await expect(page.getByText("Unfinished final")).toHaveCount(0);
	});

	await test.step("a link to a meeting in a past week unfolds it", async () => {
		await page.goto(`${href}/schedule#event-${first.id}`);
		await expect(page.getByText("First meeting")).toBeVisible();
	});
});

test("a meeting lists its resources as links that behave as on the Resources tab; general resources stay off the schedule", async ({
	page,
}) => {
	const student = await seedUser({ role: "STUDENT" });
	const course = await persistedCourseFactory.create({
		startAt: new Date(Date.now() - 70 * DAY),
		endAt: new Date(Date.now() + 70 * DAY),
	});
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	const slot = await persistedTimeSlotFactory.create({
		course: course.id,
		day: futureDate(0).day,
	});
	const withResources = await persistedCalendarEventFactory.create({
		course: course.id,
		timeSlot: slot.id,
		week: 12,
		title: "Meeting with material",
	});
	const bare = await persistedCalendarEventFactory.create({
		course: course.id,
		timeSlot: slot.id,
		week: 13,
		title: "Meeting without material",
	});
	const event = { week: 12, timeSlot: slot.slug };
	const make = (
		slug: string,
		title: string,
		data: ResourceCreate["data"],
		attach = true,
	) =>
		db.resource.create(
			{
				course: course.id,
				slug,
				title,
				data,
				event: attach ? event : null,
			},
			FULL_ACCESS,
		);
	const file = await make("lecture-slides", "Lecture slides", {
		type: "FILE",
		filename: "slides.pdf",
		buffer: Buffer.from("%PDF-1.4 schedule test"),
	});
	await make("reference", "Language reference", {
		type: "LINK",
		url: "https://example.com/reference",
	});
	await make("lesson-notes", "Lesson notes", {
		type: "MD",
		content: "# Notes",
	});
	await make("demo-snippet", "Demo snippet", {
		type: "CODE",
		language: "python",
		content: "print(1)",
	});
	await make(
		"course-policy",
		"Course policy",
		{ type: "MD", content: "# Policy" },
		false,
	);
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});

	await logInAs(page, student);
	await page.goto(`${href}/schedule`);

	const list = page
		.locator(`#event-${withResources.id}`)
		.getByRole("list", { name: "Resources" });

	await test.step("one link per resource of the meeting, named by its title", async () => {
		await expect(list.getByRole("link")).toHaveCount(4);
		for (const title of [
			"Lecture slides",
			"Language reference",
			"Lesson notes",
			"Demo snippet",
		]) {
			await expect(list.getByRole("link", { name: title })).toHaveCount(1);
		}
	});

	await test.step("a file downloads under the name the Resources tab uses", async () => {
		const link = list.getByRole("link", { name: "Lecture slides" });
		expect(file.data.type).toBe("FILE");
		if (file.data.type !== "FILE") return;
		await expect(link).toHaveAttribute("href", file.data.link);
		await expect(link).toHaveAttribute(
			"download",
			fileDownloadName(file, file.data),
		);
	});

	await test.step("a link opens its url in another tab", async () => {
		const link = list.getByRole("link", { name: "Language reference" });
		await expect(link).toHaveAttribute("href", "https://example.com/reference");
		await expect(link).toHaveAttribute("target", "_blank");
	});

	await test.step("a note and a snippet open their own pages", async () => {
		await expect(
			list.getByRole("link", { name: "Lesson notes" }),
		).toHaveAttribute("href", `${href}/resources/lesson-notes`);
		await expect(
			list.getByRole("link", { name: "Demo snippet" }),
		).toHaveAttribute("href", `${href}/resources/demo-snippet`);
	});

	await test.step("a general resource appears nowhere on the schedule", async () => {
		await expect(page.getByText("Course policy")).toHaveCount(0);
	});

	await test.step("a meeting with no resources has no Resources list", async () => {
		await expect(page.locator(`#event-${bare.id}`)).toBeVisible();
		await expect(
			page
				.locator(`#event-${bare.id}`)
				.getByRole("list", { name: "Resources" }),
		).toHaveCount(0);
	});
});
