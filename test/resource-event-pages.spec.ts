import { expect, type Page, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { persistedCalendarEventFactory } from "@/fixtures/calendar-event.factory";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedTimeSlotFactory } from "@/fixtures/time-slot.factory";
import { courseHref } from "@/urls";
import { logInAs, resetDatabase, seedUser } from "./stories/helpers";

test.beforeEach(resetDatabase);

const NOTE = "Material for each meeting is on the schedule.";

/// An enrolled student, a course, one meeting and the course's URL.
async function setup(page: Page) {
	const student = await seedUser({ role: "STUDENT" });
	const course = await persistedCourseFactory.create();
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	const slot = await persistedTimeSlotFactory.create({ course: course.id });
	const meeting = await persistedCalendarEventFactory.create({
		course: course.id,
		timeSlot: slot.id,
		week: 3,
		title: "Meeting three",
	});
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});
	await logInAs(page, student);

	const add = (
		slug: string,
		title: string,
		data: Parameters<typeof db.resource.create>[0]["data"],
		attached: boolean,
	) =>
		db.resource.create(
			{
				course: course.id,
				slug,
				title,
				data,
				event: attached ? { week: 3, timeSlot: slot.slug } : null,
			},
			FULL_ACCESS,
		);
	return { href, meeting, add };
}

const link = { type: "LINK" as const, url: "https://example.com/x" };
const md = { type: "MD" as const, content: "# Hello" };
const code = {
	type: "CODE" as const,
	language: "python",
	content: "print(1)",
};

test("the Resources tab lists general resources only and points to the schedule when the course has event resources", async ({
	page,
}) => {
	const { href, add } = await setup(page);
	await add("general", "General reading", link, false);
	await add("per-meeting", "Meeting slides", link, true);

	await page.goto(`${href}/resources`);

	await expect(page.getByText("General reading")).toBeVisible();
	await expect(page.getByText("Meeting slides")).toHaveCount(0);
	const line = page.getByText(NOTE);
	await expect(line).toBeVisible();
	await expect(line.getByRole("link", { name: "schedule" })).toHaveAttribute(
		"href",
		`${href}/schedule`,
	);
});

test("the Resources tab shows no schedule line when every resource is general", async ({
	page,
}) => {
	const { href, add } = await setup(page);
	await add("general", "General reading", link, false);

	await page.goto(`${href}/resources`);

	await expect(page.getByText("General reading")).toBeVisible();
	await expect(page.getByText(NOTE)).toHaveCount(0);
});

test("a course whose only resources belong to meetings shows the schedule line, not a bare empty tab", async ({
	page,
}) => {
	const { href, add } = await setup(page);
	await add("per-meeting", "Meeting slides", link, true);

	await page.goto(`${href}/resources`);

	await expect(page.getByText("Meeting slides")).toHaveCount(0);
	const line = page.getByText(NOTE);
	await expect(line).toBeVisible();
	await expect(line.getByRole("link", { name: "schedule" })).toHaveAttribute(
		"href",
		`${href}/schedule`,
	);
});

test("the course home previews general resources only, even when an event resource is newer", async ({
	page,
}) => {
	const { href, add } = await setup(page);
	await add("g1", "General one", link, false);
	await add("g2", "General two", link, false);
	await add("newest", "Newest meeting slides", link, true);

	await page.goto(href);

	const section = page.locator("section", {
		has: page.getByRole("heading", { name: "Resources" }),
	});
	await expect(section.getByText("General one")).toBeVisible();
	await expect(section.getByText("General two")).toBeVisible();
	await expect(page.getByText("Newest meeting slides")).toHaveCount(0);
});

for (const [kind, data] of [
	["note", md],
	["snippet", code],
] as const) {
	test(`the page of an event ${kind} links back to its meeting on the schedule`, async ({
		page,
	}) => {
		const { href, meeting, add } = await setup(page);
		await add("event-item", "Event item", data, true);

		await page.goto(`${href}/resources/event-item`);

		await expect(
			page.getByRole("link", { name: "← Schedule" }),
		).toHaveAttribute("href", `${href}/schedule#event-${meeting.id}`);
		await expect(page.getByRole("link", { name: "← Resources" })).toHaveCount(
			0,
		);
	});

	test(`the page of a general ${kind} keeps its link back to the Resources tab`, async ({
		page,
	}) => {
		const { href, add } = await setup(page);
		await add("general-item", "General item", data, false);

		await page.goto(`${href}/resources/general-item`);

		await expect(
			page.getByRole("link", { name: "← Resources" }),
		).toHaveAttribute("href", `${href}/resources`);
		await expect(page.getByRole("link", { name: "← Schedule" })).toHaveCount(0);
	});
}
