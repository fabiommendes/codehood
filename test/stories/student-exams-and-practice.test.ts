import { FULL_ACCESS } from "@/auth/actor";
import { type Course, db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { courseHref } from "@/urls";
import { expect, test } from "../fixtures";
import {
	attachmentsWith,
	blobOf,
	createQuestion,
	download,
	filesOf,
	isAbove,
	link,
} from "./attachment-support";
import { logInAs, resetDatabase, seedUser } from "./helpers";

test.beforeEach(resetDatabase);

const MINUTE = 60_000;

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
		scheduledAt: new Date(now - 10 * 60_000),
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

	await test.step("the course home page lists the open exam, then the upcoming one, under Exams", async () => {
		await page.goto(hrefOf(course));

		const rows = section(page, "Exams")
			.getByRole("link")
			.filter({ hasNotText: "View all" });
		await expect(rows).toHaveCount(2);
		await expect(rows.nth(0)).toContainText(open.title);
		await expect(rows.nth(1)).toContainText(upcoming.title);
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
			page.getByRole("heading", { name: "Exams", exact: true }),
		).toHaveCount(0);
	});

	await test.step("a course with no exams at all omits the section entirely", async () => {
		const examlessCourse = await persistedCourseFactory.create();
		await enroll(examlessCourse.id, student.username);

		await page.goto(hrefOf(examlessCourse));

		await expect(
			page.getByRole("heading", { name: "Exams", exact: true }),
		).toHaveCount(0);
		await expect(
			page.getByRole("heading", { name: "Practice", exact: true }),
		).toHaveCount(0);
	});
});

test("student: use the files attached to an exam question", async ({
	page,
}) => {
	const student = await seedUser({ role: "STUDENT", username: "file-reader" });
	const course = await persistedCourseFactory.create();
	await enroll(course.id, student.username);
	const href = hrefOf(course);
	const apiBase = `/api/course${href}`;

	const csv = blobOf("city,pop\nRecife,1\n");
	const sheet = blobOf("formula,value\nE,mc2\n");
	const stem = "Which city has the smallest population in the dataset?";
	const preamble = "Read all the instructions before you start.";
	const snippet = 'print("hello attachments")';
	const question = await createQuestion({
		course: course.id,
		slug: "q-data",
		version: "v1",
		stem,
		attachments: [
			link("cities.csv"),
			{ name: "helper.py", format: "py", text: snippet },
		],
		blobs: { "cities.csv": csv },
	});
	const publicId = (
		await prisma.questionRef.findFirstOrThrow({
			where: { courseId: course.id, slug: "q-data" },
		})
	).publicId;
	await db.exam.create(
		{
			course: course.id,
			slug: "files-exam",
			title: "Files exam",
			type: "EXAM",
			status: "SCHEDULED",
			scheduledAt: new Date(Date.now() + 3 * 24 * 60 * MINUTE),
			duration: { hours: 2 },
			preamble,
			questions: [{ slug: question.slug }],
			attachments: [link("formulas.csv")],
			...filesOf({ "formulas.csv": sheet }),
		} as Parameters<typeof db.exam.create>[0],
		FULL_ACCESS,
	);

	await logInAs(page, student);

	await test.step("before the exam opens there is no list and no download", async () => {
		await page.goto(`${href}/exams/files-exam`);

		await expect(page.getByText(preamble)).toBeVisible();
		await expect(
			page.getByRole("region", { name: "Attachments", exact: true }),
		).toHaveCount(0);
		await expect(page.getByText("formulas.csv")).toHaveCount(0);
		await expect(page.getByText("cities.csv")).toHaveCount(0);

		for (const url of [
			`${apiBase}/exam/files-exam/attachment/formulas.csv`,
			`${apiBase}/exam/files-exam/question/q-data/attachment/cities.csv`,
			`/api/question/${publicId}/attachment/cities.csv`,
		]) {
			expect((await page.request.get(url)).status(), url).toBe(404);
		}
	});

	await db.exam.update(
		{ course: course.id, slug: "files-exam" },
		{ scheduledAt: new Date(Date.now() - 10 * MINUTE) },
		FULL_ACCESS,
	);

	await test.step("once open, the exam's files sit under its instructions and download", async () => {
		await page.goto(`${href}/exams/files-exam`);

		const list = attachmentsWith(page, "formulas.csv");
		await expect(list).toBeVisible();
		expect(await isAbove(page.getByText(preamble), list)).toBe(true);

		const saved = await download(page, list, "formulas.csv");
		expect(saved.filename).toBe("formulas.csv");
		expect(saved.bytes.equals(sheet.bytes)).toBe(true);
	});

	await test.step("the question lists its files under the statement", async () => {
		await page.getByRole("button", { name: "Start exam" }).click();
		await expect(page.getByText(stem)).toBeVisible();

		const list = attachmentsWith(page, "cities.csv");
		await expect(list).toBeVisible();
		await expect(list.getByRole("link", { name: "helper.py" })).toBeVisible();
		expect(await isAbove(page.getByText(stem), list)).toBe(true);
	});

	await test.step("a linked file downloads with its original name", async () => {
		const saved = await download(
			page,
			attachmentsWith(page, "cities.csv"),
			"cities.csv",
		);
		expect(saved.filename).toBe("cities.csv");
		expect(saved.bytes.equals(csv.bytes)).toBe(true);
	});

	await test.step("an inline file downloads too, and its code is readable in a collapsed block", async () => {
		const list = attachmentsWith(page, "cities.csv");

		const saved = await download(page, list, "helper.py");
		expect(saved.filename).toBe("helper.py");
		expect(saved.bytes.toString("utf8")).toBe(snippet);

		const block = list.locator("details").filter({ hasText: "hello" });
		await expect(block).toHaveCount(1);
		await expect(block.getByText(snippet)).toBeHidden();
		await block.locator("summary").click();
		await expect(block.getByText(snippet)).toBeVisible();
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
 * uses for "Exams", "Resources" and "Schedule".
 */
function section(page: import("@playwright/test").Page, title: string) {
	return page.locator("section").filter({
		has: page.getByRole("heading", { name: title, exact: true }),
	});
}
