import { expect, type Page, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { type Course, db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCalendarEventFactory } from "@/fixtures/calendar-event.factory";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedResourceFactory } from "@/fixtures/resource.factory";
import { persistedTimeSlotFactory } from "@/fixtures/time-slot.factory";
import { courseHref } from "@/urls";
import { localDateOf, SERVER_TZ } from "@/utils/schedule-time";
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

	await test.step("the page is titled as their own list", async () => {
		await expect(
			page.getByRole("heading", { name: "My courses", exact: true }),
		).toBeVisible();
		await expect(page.getByText("Courses you take or teach.")).toBeVisible();
	});

	await test.step("a course they are not in answers 403, without echoing the URL segment", async () => {
		const response = await page.goto(hrefOf(other));
		expect(response?.status()).toBe(403);
		await expect(
			page.getByText("You don't have permission to view this course."),
		).toBeVisible();
		await expect(
			page.getByText(`${other.instructor.username}_${other.edition.slug}`),
		).toHaveCount(0);
	});

	await test.step("a course that does not exist answers 404 instead", async () => {
		const response = await page.goto(
			`/${mine.discipline.slug}/nobody_${mine.edition.slug}`,
		);
		expect(response?.status()).toBe(404);
		await expect(
			page.getByRole("link", { name: "← Back to my courses" }),
		).toHaveAttribute("href", "/courses");
	});

	await test.step("a signed-out visitor's 404 leads to the home page instead", async () => {
		await page.context().clearCookies();
		const response = await page.goto("/no-such-page-anywhere");
		expect(response?.status()).toBe(404);
		await expect(
			page.getByRole("link", { name: "← Back to the home page" }),
		).toHaveAttribute("href", "/");
		await expect(
			page.getByRole("link", { name: "← Back to my courses" }),
		).toHaveCount(0);
		await logInAs(page, student);
	});

	// Being in the course is not the same as running it.
	await test.step("the instructor's tabs on their own course answer 403", async () => {
		expect((await page.goto(`${hrefOf(mine)}/manage`))?.status()).toBe(403);
		expect((await page.goto(`${hrefOf(mine)}/roster`))?.status()).toBe(403);
		expect((await page.goto(`${hrefOf(mine)}/questions`))?.status()).toBe(403);
		await page.goto(hrefOf(mine));
		await expect(
			page.getByRole("tab", { name: "Questions", exact: true }),
		).toHaveCount(0);
	});
});

test("student: read the course home page", async ({ page }) => {
	const student = await seedUser({ role: "STUDENT" });
	const course = await persistedCourseFactory.create({
		description: "Learn how to reason about programs, not just write them.",
	});
	await enroll(course.id, student.username);

	const { day } = futureDate(2);
	const slot = await persistedTimeSlotFactory.create({
		course: course.id,
		day,
		title: "Lecture",
	});
	await persistedCalendarEventFactory.create({
		course: course.id,
		timeSlot: slot.id,
		week: 1,
		title: "Introduction to recursion",
	});

	// Three active students, one who dropped; two exams a student sees, one draft.
	for (const username of ["home-peer-1", "home-peer-2"]) {
		await seedUser({ role: "STUDENT", username });
		await enroll(course.id, username);
	}
	await seedUser({ role: "STUDENT", username: "home-dropout" });
	await enroll(course.id, "home-dropout");
	await prisma.enrollment.update({
		where: {
			username_courseId: { username: "home-dropout", courseId: course.id },
		},
		data: { status: "DROPPED" },
	});
	for (const [slug, status] of [
		["home-exam-1", "SCHEDULED"],
		["home-exam-2", "ONGOING"],
		["home-exam-draft", "DRAFT"],
	] as const) {
		await persistedExamFactory.create({ course: course.id, slug, status });
	}

	// Four resources, more than the home page lists.
	const resourceTitles: Record<string, string> = {
		"lecture-notes": "Lecture notes",
		"problem-set-1": "Problem set 1",
		"reading-list": "Reading list",
		"lab-guide": "Lab guide",
	};
	for (const [slug, title] of Object.entries(resourceTitles)) {
		await persistedResourceFactory.create({
			course: course.id,
			slug,
			title,
			data: { type: "MD", content: `# ${title}` },
		});
	}

	await logInAs(page, student);
	await page.goto(hrefOf(course));

	await expect(
		page.getByRole("heading", { name: course.discipline.name }),
	).toBeVisible();
	await expect(page.getByText(course.instructor.name)).toBeVisible();
	await expect(page.getByText(course.description as string)).toBeVisible();
	await expect(page.getByText("Introduction to recursion")).toBeVisible();

	await test.step("the Resources section lists at most three real resources, each linking to its page", async () => {
		const resources = section(page, "Resources");

		await expect(resources.locator('a[href*="/resources/"]')).toHaveCount(3);
		let listed = 0;
		for (const [slug, title] of Object.entries(resourceTitles)) {
			const link = resources.getByRole("link", { name: title });
			if ((await link.count()) === 0) continue;
			listed++;
			await expect(link).toHaveAttribute(
				"href",
				`${hrefOf(course)}/resources/${slug}`,
			);
		}
		expect(listed).toBe(3);

		await expect(
			resources.getByRole("link", { name: "View all" }),
		).toHaveAttribute("href", `${hrefOf(course)}/resources`);
	});

	await test.step("no placeholder rows appear", async () => {
		await expect(page.getByText("Syllabus")).toHaveCount(0);
		await expect(page.getByText("Course repository")).toHaveCount(0);
		await expect(page.getByText("codehood-cs101/coursework")).toHaveCount(0);
	});

	await test.step("a course without resources says so and lists no rows", async () => {
		const bare = await persistedCourseFactory.create();
		await enroll(bare.id, student.username);
		await page.goto(hrefOf(bare));

		const resources = section(page, "Resources");
		await expect(resources).toContainText("No resources yet");
		await expect(resources.locator('a[href*="/resources/"]')).toHaveCount(0);
		await expect(page.getByText("Syllabus")).toHaveCount(0);
	});
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
			course: course.id,
			slug: "lecture-notes",
			title: "Lecture notes",
			data: { type: "FILE", buffer, filename: "lecture-notes.pdf" },
			rev: "lecture-notes-hash",
		},
		FULL_ACCESS,
	);
	await persistedResourceFactory.create({
		course: course.id,
		title: "Syllabus overview",
		description: null,
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
		const downloadLink = page.getByRole("link", { name: /Lecture notes/ });
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

	await test.step("clicking a link opens its site in another tab", async () => {
		const link = page.getByRole("link", { name: /Syllabus overview/ });
		await expect(link).toHaveAttribute("href", "https://example.com/syllabus");
		await expect(link).toHaveAttribute("target", "_blank");
		await expect(link).toContainText("example.com");
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

	const { day } = futureDate(3);
	const slot = await persistedTimeSlotFactory.create({
		course: course.id,
		day,
		title: "Lecture",
		start: { hour: 9, minute: 0 },
		duration: { minutes: 50 },
	});
	await persistedCalendarEventFactory.create({
		course: course.id,
		timeSlot: slot.id,
		week: 1,
		title: "Kickoff",
		description: "Course overview and expectations.",
	});
	await persistedCalendarEventFactory.create({
		course: course.id,
		timeSlot: slot.id,
		week: 2,
		kind: "CANCELLED",
		title: "Second lecture",
	});
	await persistedCalendarEventFactory.create({
		course: course.id,
		timeSlot: slot.id,
		week: 3,
		kind: "HOLIDAY",
		title: "Spring break",
	});

	await logInAs(page, student);
	await page.goto(`${hrefOf(course)}/schedule`);

	await test.step("the intro reads as plain copy", async () => {
		await expect(page.getByText("The term, week by week.")).toBeVisible();
		await expect(page.getByText("authored week")).toHaveCount(0);
	});

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
		await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
	});

	await test.step("kinds read as words: holidays are labelled, regular meetings carry no badge", async () => {
		await expect(page.getByText("Spring break")).toBeVisible();
		await expect(page.getByText("Holiday", { exact: true })).toBeVisible();
		await expect(page.getByText("Regular", { exact: true })).toHaveCount(0);
		for (const raw of ["REGULAR", "HOLIDAY", "CANCELLED"]) {
			await expect(page.getByText(raw, { exact: true })).toHaveCount(0);
		}
	});

	await test.step("the count of meetings held so far agrees with its number", async () => {
		// Terms that began ten weeks ago, with one and six meetings behind them.
		for (const held of [1, 6]) {
			const past = await persistedCourseFactory.create({
				startAt: new Date(Date.now() - 70 * 86_400_000),
				endAt: new Date(Date.now() + 70 * 86_400_000),
			});
			await enroll(past.id, student.username);
			const pastSlot = await persistedTimeSlotFactory.create({
				course: past.id,
				day: futureDate(0).day,
			});
			for (let week = 0; week < held; week++) {
				await persistedCalendarEventFactory.create({
					course: past.id,
					timeSlot: pastSlot.id,
					week,
					title: `Past meeting ${week}`,
				});
			}

			await page.goto(`${hrefOf(past)}/schedule`);
			await expect(
				page.getByText(
					held === 1
						? "1 meeting held so far."
						: `${held} meetings held so far.`,
				),
			).toBeVisible();
			await expect(page.getByText("meeting(s)")).toHaveCount(0);
		}
	});
});

test("student: see all my courses in one calendar", async ({ page }) => {
	const student = await seedUser({ role: "STUDENT" });
	const courseA = await persistedCourseFactory.create();
	const courseB = await persistedCourseFactory.create();
	await enroll(courseA.id, student.username);
	await enroll(courseB.id, student.username);

	const { day } = futureDate(2);
	for (const course of [courseA, courseB]) {
		const slot = await persistedTimeSlotFactory.create({
			course: course.id,
			day,
		});
		await persistedCalendarEventFactory.create({
			course: course.id,
			timeSlot: slot.id,
			week: 1,
			title: `${course.discipline.name} kickoff`,
		});
	}

	await logInAs(page, student);
	await page.goto("/calendar");

	await expect(
		page.getByText(`${courseA.discipline.name} kickoff`).first(),
	).toBeVisible();
	await expect(
		page.getByText(`${courseB.discipline.name} kickoff`).first(),
	).toBeVisible();

	const longTitle =
		"A very long event title that no day cell could ever show in one line without cutting it";
	const courseC = await persistedCourseFactory.create();
	await enroll(courseC.id, student.username);
	// Its own day: a cell lists two events and folds the rest into "+N more".
	const slotC = await persistedTimeSlotFactory.create({
		course: courseC.id,
		day: futureDate(3).day,
	});
	const longEvent = await persistedCalendarEventFactory.create({
		course: courseC.id,
		timeSlot: slotC.id,
		week: 1,
		title: longTitle,
	});

	await test.step("a long title is complete in the page, with the full text on hover", async () => {
		// Its own month, which need not be the one the calendar opens on.
		const month = localDateOf(longEvent.startAt).slice(0, 7);
		await page.goto(`/calendar?month=${month}`);
		const chip = page.getByTitle(longTitle, { exact: true });
		await expect(chip).toHaveCount(1);
		await expect(chip).toContainText(longTitle);
		await expect(chip).not.toContainText("…");
	});

	await test.step("a day with events leads to the month's list, with each event's time and course", async () => {
		const dayKey = localDateOf(longEvent.startAt);
		await page.goto(`/calendar?month=${dayKey.slice(0, 7)}`);
		await page.locator(`a[href="#day-${dayKey}"]`).click();

		const day = page.locator(`#day-${dayKey}`);
		await expect(day).toBeInViewport();
		await expect(day).toContainText(longTitle);
		await expect(day).toContainText(courseC.discipline.name);
		await expect(day).toContainText(/\d{2}:\d{2}/);
	});

	await test.step("a cancelled meeting stays in the list, marked as cancelled", async () => {
		const slot = await persistedTimeSlotFactory.create({
			course: courseA.id,
			day: futureDate(4).day,
		});
		const cancelled = await persistedCalendarEventFactory.create({
			course: courseA.id,
			timeSlot: slot.id,
			week: 1,
			kind: "CANCELLED",
			title: "Lab moved online",
		});
		const dayKey = localDateOf(cancelled.startAt);
		await page.goto(`/calendar?month=${dayKey.slice(0, 7)}`);

		const day = page.locator(`#day-${dayKey}`);
		await expect(day).toContainText("Lab moved online");
		await expect(day).toContainText("Cancelled");
	});

	await test.step("a scheduled exam sits on its day next to the meetings, and a draft does not", async () => {
		const scheduledAt = new Date(Date.now() + 5 * 86_400_000);
		const quiz = await persistedExamFactory.create({
			course: courseA.id,
			slug: "cal-quiz",
			title: "Recursion quiz",
			type: "QUIZ",
			scheduledAt,
			duration: { minutes: 30 },
		});
		await persistedExamFactory.create({
			course: courseA.id,
			slug: "cal-draft",
			title: "Unannounced final",
			status: "DRAFT",
			scheduledAt,
		});
		const dayKey = localDateOf(scheduledAt);
		await page.goto(`/calendar?month=${dayKey.slice(0, 7)}`);

		await expect(page.locator(`a[href="#day-${dayKey}"]`)).toContainText(
			"Quiz",
		);
		const day = page.locator(`#day-${dayKey}`);
		const row = day.getByRole("link", { name: /Recursion quiz/ });
		await expect(row).toContainText("Quiz");
		await expect(row).toContainText(courseA.discipline.name);
		await expect(row).toContainText("30 min");
		await expect(row).toHaveAttribute(
			"href",
			`${hrefOf(courseA)}/exams/${quiz.slug}`,
		);
		await expect(page.getByText("Unannounced final")).toHaveCount(0);

		await page.goto("/calendar");
		await expect(
			page
				.getByRole("region", { name: "Upcoming" })
				.getByRole("link", { name: /Recursion quiz/ }),
		).toBeVisible();
	});

	const currentMonth = monthOfNow();

	await test.step("browsing another month offers a way back to today", async () => {
		await page.goto("/calendar?month=2020-01");
		await expect(page.getByRole("link", { name: "Today" })).toHaveAttribute(
			"href",
			`/calendar?month=${currentMonth}`,
		);
	});

	await test.step("on the current month there is nothing to go back to", async () => {
		await page.goto(`/calendar?month=${currentMonth}`);
		await expect(page.getByRole("link", { name: "Today" })).toHaveCount(0);
	});
});

test("student: open the calendar on the next event", async ({ page }) => {
	const student = await seedUser({ role: "STUDENT" });
	await logInAs(page, student);
	const monthOf = (date: Date) =>
		new Intl.DateTimeFormat("en-US", {
			month: "long",
			year: "numeric",
			timeZone: SERVER_TZ,
		}).format(date);

	// A term that ended a year ago, with a single event in its first week.
	const past = await persistedCourseFactory.create({
		startAt: new Date(Date.now() - 400 * 86_400_000),
		endAt: new Date(Date.now() - 300 * 86_400_000),
	});
	await enroll(past.id, student.username);
	const last = await persistedCalendarEventFactory.create({
		course: past.id,
		week: 1,
		title: "Old lab",
	});

	await test.step("with nothing left, it opens on the last event's month", async () => {
		await page.goto("/calendar");
		await expect(page.getByText(monthOf(last.startAt))).toBeVisible();
		await expect(
			page
				.getByRole("region", { name: `Events in ${monthOf(last.startAt)}` })
				.getByText("Old lab"),
		).toBeVisible();
	});

	// A term starting now, whose only event is months away.
	const next = await persistedCourseFactory.create();
	await enroll(next.id, student.username);
	const upcoming = await persistedCalendarEventFactory.create({
		course: next.id,
		week: 12,
		title: "Far-off review session",
	});
	expect(monthOf(upcoming.startAt)).not.toBe(monthOf(new Date()));

	await test.step("with an event ahead, it opens on that event's month", async () => {
		await page.goto("/calendar");
		await expect(page.getByText(monthOf(upcoming.startAt))).toBeVisible();
	});

	await test.step("an explicit month still wins", async () => {
		const now = new Date();
		const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
		await page.goto(`/calendar?month=${month}`);
		await expect(
			page.getByText(
				monthOf(
					new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15)),
				),
			),
		).toBeVisible();
	});

	await test.step("paging stops at the first and the last event", async () => {
		await page.goto(`/calendar?month=${localDateOf(last.startAt).slice(0, 7)}`);
		await expect(
			page.getByRole("link", { name: "Previous month" }),
		).toHaveCount(0);
		await expect(page.getByRole("link", { name: "Next month" })).toBeVisible();

		await page.goto(
			`/calendar?month=${localDateOf(upcoming.startAt).slice(0, 7)}`,
		);
		await expect(page.getByRole("link", { name: "Next month" })).toHaveCount(0);
		await expect(
			page.getByRole("link", { name: "Previous month" }),
		).toBeVisible();
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

/** The current month as `YYYY-MM`, read in the server's zone the way the calendar does. */
function monthOfNow(): string {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: SERVER_TZ,
		year: "numeric",
		month: "2-digit",
	}).formatToParts(new Date());
	const get = (type: string) => parts.find((p) => p.type === type)?.value;
	return `${get("year")}-${get("month")}`;
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

/// The `<section>` wrapping the heading `title`.
function section(page: Page, title: string) {
	return page.locator("section").filter({
		has: page.getByRole("heading", { name: title, exact: true }),
	});
}
