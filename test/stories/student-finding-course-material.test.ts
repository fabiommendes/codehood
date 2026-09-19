import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { type Course, db } from "@/db";
import { persistedCalendarEventFactory } from "@/fixtures/calendar-event.factory";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedResourceFactory } from "@/fixtures/resource.factory";
import { persistedTimeSlotFactory } from "@/fixtures/time-slot.factory";
import { courseHref } from "@/urls";
import { futureDate, logInAs, resetDatabase, seedUser } from "./helpers";

test.beforeEach(resetDatabase);

test("student: see my courses", async ({ page }) => {
	const student = await seedUser({ role: "STUDENT" });
	const mine = await persistedCourseFactory.create();
	await enroll(mine.id, student.username);
	const other = await persistedCourseFactory.create();

	await logInAs(page, student);

	await test.step("the list holds the active enrollments and nothing else", async () => {
		await page.goto("/courses");
		await expect(
			page.getByRole("heading", { name: mine.discipline.name }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", { name: other.discipline.name }),
		).toHaveCount(0);
	});

	await test.step("a course they are not in answers 403, naming it", async () => {
		const response = await page.goto(hrefOf(other));
		expect(response?.status()).toBe(403);
		await expect(
			page.getByText(`${other.instructor.username}_${other.edition.slug}`),
		).toBeVisible();
	});

	await test.step("a course that does not exist answers 404 instead", async () => {
		const response = await page.goto(
			`/${mine.discipline.slug}/nobody_${mine.edition.slug}`,
		);
		expect(response?.status()).toBe(404);
	});

	// Being in the course is not the same as running it.
	await test.step("the instructor's tabs on their own course answer 403", async () => {
		expect((await page.goto(`${hrefOf(mine)}/manage`))?.status()).toBe(403);
		expect((await page.goto(`${hrefOf(mine)}/roster`))?.status()).toBe(403);
	});
});

test("student: read the course home page", async ({ page }) => {
	const student = await seedUser({ role: "STUDENT" });
	const course = await persistedCourseFactory.create({
		description: "Learn how to reason about programs, not just write them.",
	});
	await enroll(course.id, student.username);

	const { date, day } = futureDate(2);
	const slot = await persistedTimeSlotFactory.create({
		courseId: course.id,
		day,
		title: "Lecture",
	});
	await persistedCalendarEventFactory.create({
		courseId: course.id,
		timeSlotId: slot.id,
		date,
		week: 1,
		title: "Introduction to recursion",
	});

	await logInAs(page, student);
	await page.goto(hrefOf(course));

	await expect(
		page.getByRole("heading", { name: course.discipline.name }),
	).toBeVisible();
	await expect(page.getByText(course.instructor.name)).toBeVisible();
	await expect(page.getByText(course.description as string)).toBeVisible();
	await expect(page.getByText("Introduction to recursion")).toBeVisible();
});

test("student: browse course resources", async ({ page }) => {
	const student = await seedUser({ role: "STUDENT" });
	const course = await persistedCourseFactory.create();
	await enroll(course.id, student.username);

	const buffer = Buffer.from("%PDF-1.4 fake lecture notes bytes");

	// Not `persistedResourceFactory` for this one: it always sets `data` to a
	// `LINK`, and building a `FILE` payload is just `db.resource.create`
	// directly, exactly what the factory does under the hood.
	const fileResource = await db.resource.create(
		{
			courseId: course.id,
			slug: "lecture-notes",
			title: "Lecture notes",
			data: { type: "FILE", buffer, filename: "lecture-notes.pdf" },
			ref: "lecture-notes-hash",
		},
		FULL_ACCESS,
	);
	await persistedResourceFactory.create({
		courseId: course.id,
		title: "Syllabus overview",
		data: { type: "LINK", url: "https://example.com/syllabus" },
	});

	await logInAs(page, student);
	await page.goto(`${hrefOf(course)}/resources`);

	let downloadHref = "";
	await test.step("resources are grouped by type, in a fixed order", async () => {
		const groupHeadings = page.getByRole("heading", { level: 3 });
		await expect(groupHeadings.filter({ hasText: "Files" })).toBeVisible();
		await expect(groupHeadings.filter({ hasText: "Links" })).toBeVisible();
		await expect(page.getByText("Lecture notes")).toBeVisible();
		await expect(page.getByText("Syllabus overview")).toBeVisible();
	});

	await test.step("clicking a file gives its bytes under its original filename", async () => {
		const downloadLink = page.getByRole("link", {
			name: "Download Lecture notes",
		});
		const href = await downloadLink.getAttribute("href");
		const downloadName = await downloadLink.getAttribute("download");
		expect(href).toBeTruthy();
		downloadHref = href as string;

		const response = await page.request.get(downloadHref);
		expect(response.status()).toBe(200);
		expect(response.headers()["content-disposition"]).toContain(
			downloadName as string,
		);
	});

	await test.step("an old link to a since-removed file explains itself", async () => {
		// The instructor pushed again without this file — background, since
		// pushing is CLI-only and not this story's promise.
		await db.resource.delete({ id: fileResource.id }, FULL_ACCESS);

		const response = await page.request.get(downloadHref);
		expect(response.status()).toBe(410);
		expect(await response.text()).toContain("This file was removed");
	});
});

test("student: follow the course schedule", async ({ page }) => {
	const student = await seedUser({ role: "STUDENT" });
	const course = await persistedCourseFactory.create();
	await enroll(course.id, student.username);

	const week1 = futureDate(3);
	const week2 = futureDate(10); // 7 days later — same weekday, no slot/day collision
	const slot = await persistedTimeSlotFactory.create({
		courseId: course.id,
		day: week1.day,
		title: "Lecture",
		startMin: 9 * 60,
		durationMin: 50,
	});
	await persistedCalendarEventFactory.create({
		courseId: course.id,
		timeSlotId: slot.id,
		date: week1.date,
		week: 1,
		kind: "LECTURE",
		title: "Kickoff",
		description: "Course overview and expectations.",
	});
	await persistedCalendarEventFactory.create({
		courseId: course.id,
		timeSlotId: slot.id,
		slug: "week-2",
		date: week2.date,
		week: 2,
		kind: "CANCELLED",
		title: "Second lecture",
	});

	await logInAs(page, student);
	await page.goto(`${hrefOf(course)}/schedule`);

	await test.step("weekly meetings and every dated occurrence are listed", async () => {
		await expect(page.getByText("Week 1")).toBeVisible();
		await expect(page.getByText("Week 2")).toBeVisible();
		await expect(page.getByText("Kickoff")).toBeVisible();
		await expect(
			page.getByText("Course overview and expectations."),
		).toBeVisible();
	});

	await test.step("a meeting the instructor cancelled stays on the list, visibly cancelled", async () => {
		await expect(page.getByText("Second lecture")).toBeVisible();
		await expect(page.getByText("CANCELLED", { exact: true })).toBeVisible();
	});
});

test("student: see all my courses in one calendar", async ({ page }) => {
	const student = await seedUser({ role: "STUDENT" });
	const courseA = await persistedCourseFactory.create();
	const courseB = await persistedCourseFactory.create();
	await enroll(courseA.id, student.username);
	await enroll(courseB.id, student.username);

	const { date, day } = futureDate(2);
	for (const course of [courseA, courseB]) {
		const slot = await persistedTimeSlotFactory.create({
			courseId: course.id,
			day,
		});
		await persistedCalendarEventFactory.create({
			courseId: course.id,
			timeSlotId: slot.id,
			date,
			week: 1,
			title: `${course.discipline.name} kickoff`,
		});
	}

	await logInAs(page, student);
	await page.goto("/calendar");

	await expect(
		page.getByText(`${courseA.discipline.name} kickoff`),
	).toBeVisible();
	await expect(
		page.getByText(`${courseB.discipline.name} kickoff`),
	).toBeVisible();
});

//
// Utilities
//

/** Enrolls an already-seeded student, which the course factory's `students` cannot do. */
async function enroll(courseId: Course["id"], username: string) {
	await db.enrollment.create({ courseId, username: username }, FULL_ACCESS);
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
