import { expect, type Locator, type Page, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { courseHref } from "@/urls";
import { logInAs, resetDatabase, seedUser } from "./stories/helpers";

// Pushed grade columns on the Grades tab and on the student's course home.

test.beforeEach(resetDatabase);

const DAY = 24 * 60 * 60_000;

type Course = Awaited<ReturnType<typeof persistedCourseFactory.create>>;
type Person = Awaited<ReturnType<typeof seedUser>>;

async function setup(prefix: string) {
	const teacher = await seedUser({
		role: "INSTRUCTOR",
		username: `${prefix}-teacher`,
	});
	const course = await persistedCourseFactory.create({
		instructor: teacher.username,
	});
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});
	return { teacher, course, href, opts: { actor: teacher } };
}

async function enrolled(course: Course, username: string, name: string) {
	const person = await seedUser({ role: "STUDENT", username, name });
	await db.enrollment.create({ course: course.id, username }, FULL_ACCESS);
	return person;
}

async function closedExam(
	course: Course,
	slug: string,
	title: string,
	daysAgo: number,
) {
	await persistedExamFactory.create({
		course: course.id,
		slug,
		title,
		type: "EXAM",
		status: "COMPLETED",
		scheduledAt: new Date(Date.now() - daysAgo * DAY),
	});
}

async function push(
	course: Course,
	teacher: Person,
	slug: string,
	title: string,
	kind: "NUMBER" | "LABEL",
	position: number,
	values: { username: string; value: number | string }[],
) {
	return db.gradeColumn.create(
		{ course: course.id, slug, title, kind, position, values },
		{ actor: teacher },
	);
}

function gradesTable(page: Page) {
	return page.getByRole("table", { name: "Grades", exact: true });
}

function gradesHeading(page: Page) {
	return page.getByRole("heading", { level: 2, name: "Grades", exact: true });
}

/// The nearest ancestor of `table` that scrolls sideways.
async function scroller(table: Locator) {
	const handle = await table.evaluateHandle((el) => {
		for (let n = el.parentElement; n; n = n.parentElement) {
			const overflow = getComputedStyle(n).overflowX;
			if (overflow === "auto" || overflow === "scroll") return n;
		}
		return null;
	});
	const element = handle.asElement();
	if (!element) throw new Error("the table has no sideways-scrolling wrapper");
	return element;
}

test("a student in a course with no released column sees no Grades block, and the instructor sees none even with released columns", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("gp1");
	const ana = await enrolled(course, "gp1-ana", "Ana Prado");
	await push(course, teacher, "hidden", "Hidden grade", "NUMBER", 0, [
		{ username: ana.username, value: 9 },
	]);
	await push(course, teacher, "shown", "Shown grade", "NUMBER", 1, [
		{ username: ana.username, value: 8 },
	]);

	await test.step("a student while every column is hidden", async () => {
		await logInAs(page, ana);
		await page.goto(href);
		await expect(page.getByRole("tab", { name: "Home" })).toBeVisible();
		await expect(gradesHeading(page)).toHaveCount(0);
		await expect(page.getByText("Hidden grade")).toHaveCount(0);
	});

	await db.gradeColumn.release(
		{ course: course.id, slug: "shown" },
		{ actor: teacher },
	);

	await test.step("the instructor, with a released column", async () => {
		await page.context().clearCookies();
		await logInAs(page, teacher);
		await page.goto(href);
		await expect(page.getByRole("tab", { name: "Home" })).toBeVisible();
		await expect(gradesHeading(page)).toHaveCount(0);
		await expect(page.getByRole("list", { name: "Grades" })).toHaveCount(0);
	});
});

test("a course with a pushed column and no exams shows the table, not 'No exams yet'", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("gp2");
	const ana = await enrolled(course, "gp2-ana", "Ana Prado");
	await push(course, teacher, "final", "Final grade", "LABEL", 0, [
		{ username: ana.username, value: "MS" },
	]);
	await logInAs(page, teacher);

	await page.goto(`${href}/grades`);

	await expect(gradesTable(page)).toBeVisible();
	await expect(
		gradesTable(page).getByRole("columnheader").filter({
			hasText: "Final grade",
		}),
	).toBeVisible();
	await expect(
		page.getByRole("rowheader", { name: "Ana Prado", exact: true }),
	).toBeVisible();
	await expect(page.getByText("No exams yet.")).toHaveCount(0);
});

test("a course with neither an exam nor a pushed column says 'No exams yet'", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("gp3");
	await enrolled(course, "gp3-ana", "Ana Prado");
	await logInAs(page, teacher);

	await page.goto(`${href}/grades`);

	await expect(page.getByText("No exams yet.")).toBeVisible();
	await expect(page.getByRole("table")).toHaveCount(0);
});

test("Download CSV carries the pushed columns after the exams, headed by slug, numbers raw", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("gp4");
	const ana = await enrolled(course, "gp4-ana", "Ana Prado");
	const bia = await enrolled(course, "gp4-bia", "Bia Lima");
	await closedExam(course, "midterm", "Midterm exam", 10);
	await push(course, teacher, "final", "Final grade", "LABEL", 1, [
		{ username: ana.username, value: "MS" },
		{ username: bia.username, value: "SS" },
	]);
	await push(course, teacher, "assignments", "Assignments", "NUMBER", 0, [
		{ username: ana.username, value: 87.456 },
	]);
	await logInAs(page, teacher);
	await page.goto(`${href}/grades`);

	const [download] = await Promise.all([
		page.waitForEvent("download"),
		page.getByRole("button", { name: "Download CSV" }).click(),
	]);

	const stream = await download.createReadStream();
	const chunks: Buffer[] = [];
	for await (const chunk of stream) chunks.push(chunk as Buffer);
	expect(Buffer.concat(chunks).toString("utf8").split("\r\n")).toEqual([
		"username,name,status,midterm,assignments,final",
		"gp4-ana,Ana Prado,active,,87.456,MS",
		"gp4-bia,Bia Lima,active,,,SS",
	]);
});

test("on a 390 px screen the table scrolls inside its container, the page does not, and the Student header stays at the container's left edge", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("gp5");
	const ana = await enrolled(
		course,
		"gp5-ana",
		"Ana Carolina Prado de Albuquerque",
	);
	await closedExam(course, "quiz-one", "Quiz 1: recursion and friends", 20);
	await closedExam(course, "midterm", "Midterm exam of the semester", 10);
	await push(
		course,
		teacher,
		"assignments",
		"Assignments of the whole semester",
		"NUMBER",
		0,
		[{ username: ana.username, value: 87.456 }],
	);
	await push(course, teacher, "final", "Final grade as a letter", "LABEL", 1, [
		{ username: ana.username, value: "MS" },
	]);
	await page.setViewportSize({ width: 390, height: 800 });
	await logInAs(page, teacher);

	await page.goto(`${href}/grades`);
	await expect(gradesTable(page)).toBeVisible();

	const wrapper = await scroller(gradesTable(page));
	expect(await wrapper.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
		true,
	);
	expect(
		await page.evaluate(
			() =>
				document.documentElement.scrollWidth >
				document.documentElement.clientWidth,
		),
	).toBe(false);

	await wrapper.evaluate((el) => {
		el.scrollLeft = el.scrollWidth;
	});

	const container = await wrapper.boundingBox();
	const student = await gradesTable(page)
		.getByRole("columnheader", { name: "Student", exact: true })
		.boundingBox();
	expect(container).not.toBeNull();
	expect(student).not.toBeNull();
	expect(Math.abs((student?.x ?? 0) - (container?.x ?? 0))).toBeLessThanOrEqual(
		1,
	);
});

test("a student who posts the release action directly cannot release, while the instructor can", async ({
	request,
}) => {
	const { teacher, course, opts } = await setup("gp6");
	const ana = await enrolled(course, "gp6-ana", "Ana Prado");
	for (const slug of ["mine", "theirs"]) {
		await push(course, teacher, slug, slug, "NUMBER", 0, [
			{ username: ana.username, value: 1 },
		]);
	}
	const input = (slug: string) => ({
		discipline: course.discipline.slug,
		course: `${teacher.username}_${course.edition.slug}`,
		slug,
	});
	async function headersFor(person: Person) {
		const login = await request.post("/api/auth/login", {
			data: { login: person.username, password: person.password },
		});
		expect(login.ok()).toBe(true);
		const { token } = await login.json();
		return { Authorization: `Bearer ${token}` };
	}

	const asTeacher = await request.post("/_actions/gradeColumn.release", {
		headers: await headersFor(teacher),
		data: input("mine"),
	});
	expect(asTeacher.ok(), await asTeacher.text()).toBe(true);

	const asStudent = await request.post("/_actions/gradeColumn.release", {
		headers: await headersFor(ana),
		data: input("theirs"),
	});
	expect(asStudent.ok()).toBe(false);
	expect([403, 404]).toContain(asStudent.status());

	const mine = await db.gradeColumn.findOne(
		{ course: course.id, slug: "mine" },
		opts,
	);
	const theirs = await db.gradeColumn.findOne(
		{ course: course.id, slug: "theirs" },
		opts,
	);
	expect(mine?.releasedAt).toBeInstanceOf(Date);
	expect(theirs?.releasedAt).toBeNull();
});
