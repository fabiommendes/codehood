import { expect, type Page, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { resourceFactory } from "@/fixtures/resource.factory";
import { capitalShortAnswer } from "@/mdq/fixtures";
import { courseHref } from "@/urls";
import { logInAs, resetDatabase, seedUser } from "./stories/helpers";

test.beforeEach(resetDatabase);

/// A course and one exam, plus the instructor logged in on `page`.
async function examPage(page: Page, tag: string) {
	const teacher = await seedUser({
		role: "INSTRUCTOR",
		username: `crumb-${tag}`,
	});
	const course = await persistedCourseFactory.create({
		instructor: teacher.username,
	});
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: "midterm",
		title: "Midterm Exam",
	});
	await logInAs(page, teacher);
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});
	return { course, exam, href, url: `${href}/exams/${exam.slug}` };
}

/// Makes the page tall enough for the course header to scroll out of view.
async function padPage(page: Page) {
	await page.addStyleTag({
		content: ".drawer-content { min-height: 4000px; }",
	});
}

test.describe("breadcrumb bar", () => {
	test("desktop: the trail is in the top bar, linked, with the last crumb current", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		const { course, href, url } = await examPage(page, "markup");
		await page.goto(url);

		const nav = page
			.locator(".navbar")
			.getByRole("navigation", { name: "Breadcrumb" });
		await expect(nav).toHaveCount(1);

		const label = `${course.discipline.slug} · ${course.edition.slug}`;
		await expect(nav.getByRole("link")).toHaveText([label, "Exams"]);
		await expect(nav.getByRole("link").nth(0)).toHaveAttribute("href", href);
		await expect(nav.getByRole("link").nth(1)).toHaveAttribute(
			"href",
			`${href}/exams`,
		);

		const current = nav.locator('[aria-current="page"]');
		await expect(current).toHaveCount(1);
		await expect(current).toHaveText("Midterm Exam");
		await expect(current.locator("xpath=self::a")).toHaveCount(0);
		await expect(nav.getByRole("link", { name: "Midterm Exam" })).toHaveCount(
			0,
		);
	});

	test("desktop: shown only after the course header scrolls away, without layout shift", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 500 });
		const { course, url } = await examPage(page, "scroll");
		await page.goto(url);
		await padPage(page);

		const nav = page.getByRole("navigation", { name: "Breadcrumb" });
		const header = page.getByRole("heading", {
			level: 1,
			name: course.discipline.name,
		});
		const menu = page.locator(".navbar details.dropdown summary");

		await expect(header).toBeInViewport();
		await expect(nav).toHaveCSS("opacity", "0");
		await expect(nav).toHaveCSS("pointer-events", "none");
		const boxAtTop = await menu.boundingBox();

		await page.mouse.move(640, 300);
		await page.mouse.wheel(0, 1500);
		await expect(header).not.toBeInViewport();
		await expect(nav).toHaveCSS("opacity", "1");
		await expect(nav).toHaveCSS("pointer-events", "auto");
		await nav.getByRole("link").first().click({ trial: true });
		expect(await menu.boundingBox()).toEqual(boxAtTop);

		await page.mouse.wheel(0, -5000);
		await expect(header).toBeInViewport();
		await expect(nav).toHaveCSS("opacity", "0");
		await expect(nav).toHaveCSS("pointer-events", "none");
		expect(await menu.boundingBox()).toEqual(boxAtTop);
	});

	test("phone: the breadcrumb is not displayed, even after scrolling", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 600 });
		const { url } = await examPage(page, "phone");
		await page.goto(url);
		await padPage(page);

		const nav = page.locator('nav[aria-label="Breadcrumb"]');
		await expect(nav.locator("a")).toHaveCount(2);
		await expect(nav).not.toBeVisible();
		await page.mouse.move(200, 300);
		await page.mouse.wheel(0, 1500);
		await expect(nav).not.toBeVisible();
	});
});

type Course = Awaited<ReturnType<typeof persistedCourseFactory.create>>;

function hrefOf(course: Course): string {
	return courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});
}

/// A published short-answer question whose slug differs from its title.
async function shortQuestion(course: Course, slug: string, title: string) {
	await db.question.create(
		{
			course: course.id,
			slug,
			status: "PUBLISHED",
			version: "1",
			question: { ...capitalShortAnswer, id: slug, title },
		},
		FULL_ACCESS,
	);
}

/**
 * A course taught by `crumb-<tag>` with a question, a resource and a
 * completed exam that one named student answered. Every slug differs from
 * its title.
 */
async function gradedWorld(tag: string, examTitle = "Midterm exam") {
	const teacher = await seedUser({
		role: "INSTRUCTOR",
		username: `crumb-${tag}`,
	});
	const course = await persistedCourseFactory.create({
		instructor: teacher.username,
	});
	await shortQuestion(course, "capq", "Typed capital");
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: "mt1",
		title: examTitle,
		type: "EXAM",
		status: "ONGOING",
		questions: [{ slug: "capq" }],
	});
	const student = await seedUser({
		role: "STUDENT",
		username: `crumb-${tag}-student`,
		name: "Zelda Quixote",
	});
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	await db.response.submit(
		{
			course: course.id,
			exam: exam.slug,
			question: "capq",
			payload: { text: "Brasilia" },
		},
		{ actor: student },
	);
	await db.response.finish(
		{ course: course.id, exam: exam.slug },
		{ actor: student },
	);
	await prisma.exam.update({
		where: { id: exam.id },
		data: { status: "COMPLETED" },
	});
	await db.resource.create(
		{
			...resourceFactory.build({ course: course.id, slug: "syll" }),
			title: "Course Syllabus",
			data: { type: "MD" as const, content: "# Syllabus" },
			course: course.id,
		},
		FULL_ACCESS,
	);
	return { teacher, student, course, href: hrefOf(course) };
}

/// The trail in the breadcrumb: its links, and the text of the current crumb.
async function readTrail(page: Page) {
	const nav = page.locator('nav[aria-label="Breadcrumb"]');
	const links = await nav.locator("a").evaluateAll((els) =>
		els.map((el) => ({
			label: el.textContent?.trim() ?? "",
			href: el.getAttribute("href"),
		})),
	);
	const current = await nav
		.locator('[aria-current="page"]')
		.evaluateAll((els) => els.map((el) => el.textContent?.trim() ?? ""));
	return { links, current, text: (await nav.textContent()) ?? "" };
}

test.describe("breadcrumb trails on real pages", () => {
	test("instructor: each course page passes its trail", async ({ page }) => {
		const { teacher, course, href } = await gradedWorld("wiring");
		const label = `${course.discipline.slug} \u00b7 ${course.edition.slug}`;
		const home = { label, href };
		const exams = { label: "Exams", href: `${href}/exams` };
		const exam = { label: "Midterm exam", href: `${href}/exams/mt1` };
		await logInAs(page, teacher);

		const cases: [
			string,
			{ links: { label: string; href: string }[]; current: string },
		][] = [
			[`${href}/grades`, { links: [home], current: "Grades" }],
			[
				`${href}/exams/mt1/grading`,
				{ links: [home, exams, exam], current: "Grading" },
			],
			[
				`${href}/questions/capq`,
				{
					links: [home, { label: "Questions", href: `${href}/questions` }],
					current: "Typed capital",
				},
			],
			[
				`${href}/resources/syll`,
				{
					links: [home, { label: "Resources", href: `${href}/resources` }],
					current: "Course Syllabus",
				},
			],
			[
				`${href}/exams/mt1/attempts/crumb-wiring-student`,
				{ links: [home, exams, exam], current: "Zelda Quixote" },
			],
		];
		for (const [url, want] of cases) {
			await test.step(url, async () => {
				await page.goto(url);
				const got = await readTrail(page);
				expect({ links: got.links, current: got.current }).toEqual({
					links: want.links,
					current: [want.current],
				});
			});
		}

		await test.step("grading question keeps names=1 on the Grading link, with no student name", async () => {
			await page.goto(`${href}/exams/mt1/grading/capq?names=1`);
			await expect(page.locator("main")).toContainText("Zelda Quixote");
			const got = await readTrail(page);
			expect(got.links).toEqual([
				home,
				exams,
				exam,
				{ label: "Grading", href: `${href}/exams/mt1/grading?names=1` },
			]);
			expect(got.current).toEqual(["Typed capital"]);
			expect(got.text).not.toContain("Zelda");
			expect(got.text).not.toContain("crumb-wiring-student");
		});
	});

	test("admin and other pages: Admin > Users, and Calendar", async ({
		page,
	}) => {
		const admin = await seedUser({ role: "ADMIN", username: "crumb-admin" });
		await logInAs(page, admin);

		await page.goto("/admin/users");
		let got = await readTrail(page);
		expect(got.links).toEqual([{ label: "Admin", href: "/admin" }]);
		expect(got.current).toEqual(["Users"]);

		await page.goto("/calendar");
		got = await readTrail(page);
		expect(got.links).toEqual([]);
		expect(got.current).toEqual(["Calendar"]);
	});
});

test.describe("long trails", () => {
	test("middle crumbs truncate first and the top bar never moves", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1024, height: 600 });
		const longTitle = `Comprehensive ${"cumulative ".repeat(12)}final assessment`;
		const { teacher, course, href } = await gradedWorld("long", longTitle);
		await logInAs(page, teacher);
		const menu = page.locator(".navbar details.dropdown summary");
		const nav = page.locator('nav[aria-label="Breadcrumb"]');

		await page.goto(href);
		await padPage(page);
		const shortBox = await menu.boundingBox();

		await page.goto(`${href}/exams/mt1/grading/capq`);
		await padPage(page);
		await page.mouse.move(500, 300);
		await page.mouse.wheel(0, 1500);
		await expect(nav).toHaveCSS("opacity", "1");

		const navBox = await nav.boundingBox();
		const toggleBox = await page
			.getByRole("button", { name: "Toggle dark mode" })
			.boundingBox();
		expect(navBox).not.toBeNull();
		expect(toggleBox).not.toBeNull();
		expect((navBox?.x ?? 0) + (navBox?.width ?? 0)).toBeLessThanOrEqual(
			toggleBox?.x ?? 0,
		);
		expect(await menu.boundingBox()).toEqual(shortBox);

		const truncated = (text: string) =>
			nav
				.getByText(text, { exact: true })
				.evaluate((el) => el.scrollWidth > el.clientWidth);
		expect(await truncated(longTitle)).toBe(true);
		expect(
			await truncated(
				`${course.discipline.slug} \u00b7 ${course.edition.slug}`,
			),
		).toBe(false);
	});
});
