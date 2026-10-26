import { expect, type Locator, type Page, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { capitalShortAnswer } from "@/mdq/fixtures";
import { courseHref } from "@/urls";
import { logInAs, resetDatabase, seedUser } from "./stories/helpers";

// The class's results as one table, on the Grades tab of a course.

test.beforeEach(resetDatabase);

const DAY = 24 * 60 * 60_000;

type Course = Awaited<ReturnType<typeof persistedCourseFactory.create>>;
type Student = Awaited<ReturnType<typeof seedUser>>;

async function setup(prefix: string) {
	const teacher = await seedUser({
		role: "INSTRUCTOR",
		username: `${prefix}-teacher`,
	});
	const course = await persistedCourseFactory.create({
		instructor: teacher.username,
	});
	await db.question.create(
		{
			course: course.id,
			slug: "q-one",
			status: "PUBLISHED",
			version: "1",
			question: { ...capitalShortAnswer, id: "q-one", title: "Only question" },
		},
		FULL_ACCESS,
	);
	return { teacher, course, href: hrefOf(course) };
}

function hrefOf(course: Course) {
	return courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});
}

async function enrolledStudent(
	course: Course,
	username: string,
	name: string,
): Promise<Student> {
	const student = await seedUser({ role: "STUDENT", username, name });
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	return student;
}

type ExamState =
	/// Closed: every attempt counts.
	| { kind: "closed"; scheduledAt?: Date }
	/// Being answered, with no schedule.
	| { kind: "open"; scheduledAt?: Date }
	/// Scheduled for later.
	| { kind: "upcoming"; scheduledAt: Date };

/**
 * An exam with the single question `q-one`, answered by `sittings` before it
 * is put in `state`.
 *
 * Each sitting is a student's typed answer, its score (`null` leaves it
 * pending), and whether the attempt is finished.
 */
async function makeExam(
	course: Course,
	slug: string,
	title: string,
	state: ExamState,
	sittings: Array<{
		student: Student;
		score: string | null;
		finished?: boolean;
	}> = [],
) {
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug,
		title,
		type: "EXAM",
		status: "ONGOING",
		questions: [{ slug: "q-one" }],
	});
	for (const { student, score, finished = true } of sittings) {
		const response = await db.response.submit(
			{
				course: course.id,
				exam: slug,
				question: "q-one",
				payload: { text: `${student.username} on ${slug}` },
			},
			{ actor: student },
		);
		if (score !== null) {
			await db.feedback.create(
				{
					submission: {
						publicId: response.submissions.at(-1)?.publicId ?? "",
					},
					ref: "pass-1",
					score,
					bot: "auto",
				},
				FULL_ACCESS,
			);
		}
		if (finished) {
			await db.response.finish(
				{ course: course.id, exam: slug },
				{ actor: student },
			);
		}
	}
	await prisma.exam.update({
		where: { id: exam.id },
		data: {
			status:
				state.kind === "closed"
					? "COMPLETED"
					: state.kind === "open"
						? "ONGOING"
						: "SCHEDULED",
			...(state.scheduledAt ? { scheduledAt: state.scheduledAt } : {}),
		},
	});
	return exam;
}

function gradesTable(page: Page) {
	return page.getByRole("table", { name: "Grades", exact: true });
}

function gradesHeading(page: Page) {
	return page.getByRole("heading", { level: 2, name: "Grades", exact: true });
}

function rowOf(page: Page, name: string) {
	return page.getByRole("row").filter({
		has: page.getByRole("rowheader", { name, exact: true }),
	});
}

function headerOf(page: Page, title: string) {
	return page.getByRole("columnheader").filter({
		has: page.getByRole("link", { name: title, exact: true }),
	});
}

async function openGrades(page: Page, href: string) {
	await page.goto(`${href}/grades`);
	await expect(page).toHaveURL(`${href}/grades`);
	await expect(gradesHeading(page)).toBeVisible();
}

//
// Access
//

test("grades: the instructor gets 200, everyone else is refused, and the old gradebook path is 404", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("gr1");
	const ana = await enrolledStudent(course, "gr1-ana", "Ana Prado");
	const admin = await seedUser({ role: "ADMIN", username: "gr1-admin" });

	await test.step("the instructor", async () => {
		await logInAs(page, teacher);

		const response = await page.goto(`${href}/grades`);
		expect(response?.status()).toBe(200);
		await expect(gradesHeading(page)).toBeVisible();

		const gradebook = await page.goto(`${href}/gradebook`);
		expect(gradebook?.status()).toBe(404);
	});

	await test.step("a student of the course", async () => {
		await page.context().clearCookies();
		await logInAs(page, ana);
		const response = await page.goto(`${href}/grades`);
		expect(response?.status()).toBe(403);
	});

	await test.step("an admin who does not teach the course", async () => {
		await page.context().clearCookies();
		await logInAs(page, admin);
		const response = await page.goto(`${href}/grades`);
		expect(response?.status()).toBe(403);
	});

	await test.step("an anonymous visitor", async () => {
		await page.context().clearCookies();
		await page.goto(`${href}/grades`);

		await expect(page).toHaveURL(/\/login/);
		await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
	});
});

//
// The table
//

/// Four students against one closed exam: A 80%, B 60%, C missed, D pending.
async function classroom(prefix: string) {
	const { teacher, course, href } = await setup(prefix);
	// Created in an order that is neither alphabetical nor by username.
	const dora = await enrolledStudent(course, `${prefix}-d`, "Dora Vaz");
	const bia = await enrolledStudent(course, `${prefix}-b`, "Bia Lima");
	const ana = await enrolledStudent(course, `${prefix}-a`, "Ana Prado");
	await enrolledStudent(course, `${prefix}-c`, "Caio Nunes");
	await makeExam(
		course,
		"midterm",
		"Midterm exam",
		{ kind: "closed", scheduledAt: new Date(Date.now() - 30 * DAY) },
		[
			{ student: dora, score: null },
			{ student: bia, score: "0.6" },
			{ student: ana, score: "0.8" },
		],
	);
	return { teacher, course, href, ana, bia, dora };
}

test("grades: one closed exam shows each student's total, Pending and Missed, with the column's average", async ({
	page,
}) => {
	const { teacher, href } = await classroom("gr2");
	await logInAs(page, teacher);

	await openGrades(page, href);

	await expect(gradesTable(page)).toBeVisible();
	await expect(
		gradesTable(page).getByRole("columnheader", {
			name: "Student",
			exact: true,
		}),
	).toBeVisible();
	await expect(
		headerOf(page, "Midterm exam").getByRole("link", {
			name: "Midterm exam",
			exact: true,
		}),
	).toHaveAttribute("href", `${href}/exams/midterm`);
	await expect(headerOf(page, "Midterm exam")).toContainText(
		"avg 70% · 3 of 4",
	);
	await expect(page.getByRole("rowheader")).toHaveText([
		"Ana Prado",
		"Bia Lima",
		"Caio Nunes",
		"Dora Vaz",
	]);

	const cell = (name: string) => rowOf(page, name).getByRole("cell").first();
	await expect(cell("Ana Prado")).toHaveText("80%");
	await expect(cell("Bia Lima")).toHaveText("60%");
	await expect(cell("Caio Nunes")).toHaveText("Missed");
	await expect(cell("Dora Vaz")).toHaveText("Pending");

	await expect(cell("Ana Prado").getByRole("link")).toHaveAttribute(
		"href",
		`${href}/exams/midterm/attempts/gr2-a`,
	);
	await expect(cell("Dora Vaz").getByRole("link")).toHaveAttribute(
		"href",
		`${href}/exams/midterm/attempts/gr2-d`,
	);
	await expect(cell("Caio Nunes").getByRole("link")).toHaveCount(0);
});

test("grades: an upcoming exam has empty cells and no average, and an open one shows In progress as a link", async ({
	page,
}) => {
	const { teacher, course, href, ana } = await classroom("gr3");
	await makeExam(course, "final", "Final exam", {
		kind: "upcoming",
		scheduledAt: new Date(Date.now() + 30 * DAY),
	});
	await makeExam(course, "quiz", "Open quiz", { kind: "open" }, [
		{ student: ana, score: null, finished: false },
	]);
	await logInAs(page, teacher);

	await openGrades(page, href);

	await expect(headerOf(page, "Final exam")).toContainText(
		"no average · 0 of 4",
	);
	await expect(headerOf(page, "Open quiz")).toContainText(
		"no average · 1 of 4",
	);
	// Columns: Midterm exam, Final exam, then the unscheduled quiz.
	for (const name of ["Ana Prado", "Bia Lima", "Caio Nunes", "Dora Vaz"]) {
		await expect(rowOf(page, name).getByRole("cell").nth(1)).toHaveText("");
	}
	const progress = rowOf(page, "Ana Prado").getByRole("cell").nth(2);
	await expect(progress).toHaveText("In progress");
	await expect(progress.getByRole("link")).toHaveAttribute(
		"href",
		`${href}/exams/quiz/attempts/gr3-a`,
	);
	await expect(rowOf(page, "Bia Lima").getByRole("cell").nth(2)).toHaveText("");
});

test("grades: columns follow the scheduled date, with unscheduled exams last", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("gr4");
	await enrolledStudent(course, "gr4-ana", "Ana Prado");
	// Created in an order that matches neither the dates nor the titles.
	await makeExam(course, "mike", "Mike exam", { kind: "open" });
	await makeExam(course, "zulu", "Zulu exam", {
		kind: "open",
		scheduledAt: new Date(Date.now() - 10 * DAY),
	});
	await makeExam(course, "alpha", "Alpha exam", {
		kind: "open",
		scheduledAt: new Date(Date.now() - 20 * DAY),
	});
	await logInAs(page, teacher);

	await openGrades(page, href);

	await expect(
		gradesTable(page).getByRole("columnheader").getByRole("link"),
	).toHaveText(["Alpha exam", "Zulu exam", "Mike exam"]);
});

test("grades: a course with no exams says so, and a course with no students points to the roster", async ({
	page,
}) => {
	const empty = await setup("gr5a");
	await enrolledStudent(empty.course, "gr5a-ana", "Ana Prado");
	await logInAs(page, empty.teacher);

	await openGrades(page, empty.href);
	await expect(page.getByText("No exams yet.")).toBeVisible();
	await expect(page.getByRole("table")).toHaveCount(0);

	const lonely = await setup("gr5b");
	await makeExam(lonely.course, "midterm", "Midterm exam", { kind: "closed" });
	await page.context().clearCookies();
	await logInAs(page, lonely.teacher);

	await openGrades(page, lonely.href);
	await expect(page.getByText("No students enrolled yet.")).toBeVisible();
	await expect(
		page.getByRole("link", { name: "Students", exact: true }),
	).toHaveAttribute("href", `${lonely.href}/roster`);
	await expect(page.getByRole("table")).toHaveCount(0);
	await expect(page.getByText("No exams yet.")).toHaveCount(0);
});

test("grades: a student who dropped the course has no row, even with a graded attempt, and is left out of the counts", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("gr6");
	const ana = await enrolledStudent(course, "gr6-ana", "Ana Prado");
	const dan = await enrolledStudent(course, "gr6-dan", "Dan Dropped");
	await makeExam(course, "midterm", "Midterm exam", { kind: "closed" }, [
		{ student: ana, score: "0.8" },
		{ student: dan, score: "1" },
	]);
	await prisma.enrollment.updateMany({
		where: { username: dan.username },
		data: { status: "DROPPED" },
	});
	await logInAs(page, teacher);

	await openGrades(page, href);

	await expect(page.getByRole("rowheader")).toHaveText(["Ana Prado"]);
	await expect(page.getByText("Dan Dropped")).toHaveCount(0);
	await expect(headerOf(page, "Midterm exam")).toContainText(
		"avg 80% · 1 of 1",
	);
});

test("grades: totals show even while the exam's grades are not released", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("gr7");
	const ana = await enrolledStudent(course, "gr7-ana", "Ana Prado");
	const exam = await makeExam(
		course,
		"midterm",
		"Midterm exam",
		{
			kind: "closed",
		},
		[{ student: ana, score: "0.8" }],
	);
	const stored = await prisma.exam.findUniqueOrThrow({
		where: { id: exam.id },
	});
	expect(stored.type).toBe("EXAM");
	expect(stored.gradesReleasedAt).toBeNull();
	await logInAs(page, teacher);

	await openGrades(page, href);

	await expect(rowOf(page, "Ana Prado").getByRole("cell").first()).toHaveText(
		"80%",
	);
});

//
// Narrow screens
//

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

test("grades: on a narrow screen the table scrolls inside its wrapper, the page does not, and the student column stays in view", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("gr8");
	const ana = await enrolledStudent(course, "gr8-ana", "Ana Prado");
	await enrolledStudent(course, "gr8-bia", "Bia Lima");
	for (let i = 1; i <= 6; i++) {
		await makeExam(
			course,
			`exam-${i}`,
			`Examination number ${i} of the semester`,
			{ kind: "closed", scheduledAt: new Date(Date.now() - (10 - i) * DAY) },
			[{ student: ana, score: "0.5" }],
		);
	}
	await page.setViewportSize({ width: 390, height: 800 });
	await logInAs(page, teacher);

	await openGrades(page, href);
	await expect(gradesTable(page)).toBeVisible();

	const wrapper = await scroller(gradesTable(page));
	const wrapperOverflows = await wrapper.evaluate(
		(el) => el.scrollWidth > el.clientWidth,
	);
	expect(wrapperOverflows).toBe(true);
	const pageOverflows = await page.evaluate(
		() =>
			document.documentElement.scrollWidth >
			document.documentElement.clientWidth,
	);
	expect(pageOverflows).toBe(false);

	await wrapper.evaluate((el) => {
		el.scrollLeft = el.scrollWidth;
	});

	await expect(page.getByRole("rowheader").first()).toBeInViewport();
});

//
// Tabs
//

test("grades: the instructor's tabs have Grades before Reports, Grades the current one; a student does not get it", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("gr9");
	const ana = await enrolledStudent(course, "gr9-ana", "Ana Prado");
	await logInAs(page, teacher);

	await openGrades(page, href);

	await expect(page.getByRole("tab")).toHaveText([
		"Home",
		"Exams",
		"Resources",
		"Schedule",
		"Questions",
		"Students",
		"Grades",
		"Reports",
	]);
	await expect(
		page.getByRole("tab", { name: "Grades", selected: true }),
	).toHaveAttribute("href", `${href}/grades`);

	await page.context().clearCookies();
	await logInAs(page, ana);
	await page.goto(href);

	await expect(page).toHaveURL(href);
	await expect(page.getByRole("tab", { name: "Home" })).toBeVisible();
	await expect(page.getByRole("tab", { name: "Grades" })).toHaveCount(0);
	await expect(page.getByRole("tab")).toHaveText([
		"Home",
		"Exams",
		"Resources",
		"Schedule",
	]);
});

test("grades: Download CSV saves every student, dropped ones too, with totals as numbers", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("gr9");
	const ana = await enrolledStudent(course, "gr9-ana", "Prado, Ana");
	const bia = await enrolledStudent(course, "gr9-bia", "Bia Lima");
	const dan = await enrolledStudent(course, "gr9-dan", "Dan Dropped");
	await enrolledStudent(course, "gr9-eva", "Eva Absent");
	await makeExam(course, "midterm", "Midterm exam", { kind: "closed" }, [
		{ student: ana, score: "0.8" },
		{ student: bia, score: null },
		{ student: dan, score: "1" },
	]);
	await prisma.enrollment.updateMany({
		where: { username: dan.username },
		data: { status: "DROPPED" },
	});
	await logInAs(page, teacher);
	await openGrades(page, href);

	const [download] = await Promise.all([
		page.waitForEvent("download"),
		page.getByRole("button", { name: "Download CSV" }).click(),
	]);

	expect(download.suggestedFilename()).toBe(
		`grades-${course.discipline.slug}-${course.edition.slug}.csv`,
	);
	const stream = await download.createReadStream();
	const chunks: Buffer[] = [];
	for await (const chunk of stream) chunks.push(chunk as Buffer);
	expect(Buffer.concat(chunks).toString("utf8").split("\r\n")).toEqual([
		"username,name,status,midterm",
		"gr9-bia,Bia Lima,active,",
		"gr9-dan,Dan Dropped,dropped,100",
		"gr9-eva,Eva Absent,active,",
		'gr9-ana,"Prado, Ana",active,80',
	]);
});

test("grades: a course with no exams offers no CSV", async ({ page }) => {
	const { teacher, course, href } = await setup("gr10");
	await enrolledStudent(course, "gr10-ana", "Ana Prado");
	await logInAs(page, teacher);

	await page.goto(`${href}/grades`);

	await expect(page.getByText("No exams yet.")).toBeVisible();
	await expect(page.getByRole("button", { name: "Download CSV" })).toHaveCount(
		0,
	);
});

test("grades: on a 390 px screen two exam columns fit beside the student column", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("gr11");
	const ana = await enrolledStudent(
		course,
		"gr11-ana",
		"Ana Carolina Prado de Albuquerque",
	);
	await makeExam(
		course,
		"quiz-one",
		"Quiz 1: recursion",
		{ kind: "closed", scheduledAt: new Date(Date.now() - 20 * DAY) },
		[{ student: ana, score: "0.5" }],
	);
	await makeExam(
		course,
		"midterm",
		"Midterm exam",
		{ kind: "closed", scheduledAt: new Date(Date.now() - 10 * DAY) },
		[{ student: ana, score: "0.8" }],
	);
	await page.setViewportSize({ width: 390, height: 800 });
	await logInAs(page, teacher);

	await openGrades(page, href);

	await expect(headerOf(page, "Quiz 1: recursion")).toBeInViewport({
		ratio: 1,
	});
	await expect(headerOf(page, "Midterm exam")).toBeInViewport({ ratio: 1 });
	await expect(
		rowOf(page, "Ana Carolina Prado de Albuquerque").getByRole("cell").nth(1),
	).toBeInViewport({ ratio: 1 });
});
