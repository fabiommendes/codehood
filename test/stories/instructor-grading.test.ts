import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { capitalShortAnswer } from "@/mdq/fixtures";
import { courseHref } from "@/urls";
import { logInAs, resetDatabase, seedUser } from "./helpers";

test.beforeEach(resetDatabase);

const MINUTE = 60_000;

/// Submissions are stamped relative to this, so their order does not depend on how fast the arrange steps ran.
const T0 = new Date("2026-03-10T10:00:00Z");

test("instructor: grade submissions by hand", async ({ page }) => {
	const teacher = await seedUser({ role: "INSTRUCTOR", username: "grader" });
	const course = await persistedCourseFactory.create({
		instructor: teacher.username,
	});
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});
	await db.question.create(
		{
			course: course.id,
			slug: "q-short",
			status: "PUBLISHED",
			version: "1",
			question: {
				...capitalShortAnswer,
				id: "q-short",
				title: "Typed capital",
			},
		},
		FULL_ACCESS,
	);
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: "midterm",
		title: "Midterm exam",
		type: "EXAM",
		status: "ONGOING",
		questions: [{ slug: "q-short" }],
	});

	const students: Awaited<ReturnType<typeof seedUser>>[] = [];
	for (const [i, text] of [
		"Alpha reply",
		"Bravo reply",
		"Charlie reply",
	].entries()) {
		const student = await seedUser({
			role: "STUDENT",
			username: `gs-student-${i + 1}`,
		});
		await db.enrollment.create(
			{ course: course.id, username: student.username },
			FULL_ACCESS,
		);
		const response = await db.response.submit(
			{
				course: course.id,
				exam: exam.slug,
				question: "q-short",
				payload: { text },
			},
			{ actor: student },
		);
		await prisma.submission.update({
			where: { publicId: response.submissions.at(-1)?.publicId ?? "" },
			data: { createdAt: new Date(T0.getTime() + (i + 1) * MINUTE) },
		});
		await db.response.finish(
			{ course: course.id, exam: exam.slug },
			{ actor: student },
		);
		students.push(student);
	}
	await prisma.exam.update({
		where: { id: exam.id },
		data: { status: "COMPLETED" },
	});

	const grading = `${href}/exams/midterm/grading`;
	await logInAs(page, teacher);

	await test.step("the home page points at the exam with answers to grade", async () => {
		await page.goto("/");

		await expect(page).toHaveURL("/");
		const toGrade = page.locator("section").filter({
			has: page.getByRole("heading", { name: "To grade", exact: true }),
		});
		const item = toGrade.getByRole("link").filter({ hasText: "Midterm exam" });
		await expect(item).toContainText("3 answers to grade");
		await item.click();

		await expect(page).toHaveURL(grading);
		await expect(
			page.getByRole("heading", { level: 2, name: "Grading", exact: true }),
		).toBeVisible();
	});

	await test.step("the queue shows the question with its pending answers and opens it", async () => {
		const item = page
			.getByRole("list", { name: "Questions" })
			.getByRole("listitem")
			.filter({ hasText: "Typed capital" });
		await expect(item).toContainText("3 pending");
		await item
			.getByRole("link", { name: "Typed capital", exact: true })
			.click();

		await expect(page).toHaveURL(`${grading}/q-short`);
		await expect(
			page.getByRole("heading", {
				level: 2,
				name: "Typed capital",
				exact: true,
			}),
		).toBeVisible();
		await expect(page.getByRole("article")).toHaveCount(3);
	});

	await test.step("grading the oldest answer with a comment moves it under Graded", async () => {
		const answer = page.getByRole("article", { name: "Answer 1", exact: true });
		await expect(answer).toContainText("Alpha reply");
		await answer.getByLabel("Score (%)", { exact: true }).fill("75");
		await answer
			.getByLabel("Comment", { exact: true })
			.fill("Missing the base case");
		await answer.getByRole("button", { name: "Save grade" }).click();

		await expect(
			page.getByRole("heading", { level: 3, name: "Graded", exact: true }),
		).toBeVisible();
		const graded = page.getByRole("article").filter({ hasText: "Alpha reply" });
		await expect(graded).toContainText("75%");
		await expect(graded).toContainText("Missing the base case");
		await expect(
			graded.getByRole("button", { name: "Save grade" }),
		).toHaveCount(0);
		await expect(page.getByRole("button", { name: "Save grade" })).toHaveCount(
			2,
		);
	});

	await test.step("back in the queue, one fewer answer is pending", async () => {
		await page.getByRole("link", { name: "← Grading", exact: true }).click();

		await expect(page).toHaveURL(grading);
		const item = page
			.getByRole("list", { name: "Questions" })
			.getByRole("listitem")
			.filter({ hasText: "Typed capital" });
		await expect(item).toContainText("2 pending");
		await expect(item).toContainText("1 graded");
	});

	await test.step("the student who was graded still sees Awaiting grading and no score", async () => {
		await page.context().clearCookies();
		await logInAs(page, students[0] ?? teacher);
		await page.goto(`${href}/exams/midterm`);

		await expect(page).toHaveURL(`${href}/exams/midterm`);
		await expect(
			page.getByText("Awaiting grading", { exact: true }),
		).toBeVisible();
		await expect(page.getByText(/\d+%/)).toHaveCount(0);
		await expect(page.getByText("Missing the base case")).toHaveCount(0);
	});
	await test.step("the instructor marks one remaining answer will-not-grade, with a comment for the student", async () => {
		await page.context().clearCookies();
		await logInAs(page, teacher);
		await page.goto(`${grading}/q-short`);

		await expect(page).toHaveURL(`${grading}/q-short`);
		await expect(
			page.getByRole("heading", {
				level: 2,
				name: "Typed capital",
				exact: true,
			}),
		).toBeVisible();
		const answer = page.getByRole("article").filter({ hasText: "Bravo reply" });
		await answer.getByRole("button", { name: "Will not grade" }).click();
		const dialog = page.getByRole("dialog");
		await expect(dialog.getByText("Will not grade this answer?")).toBeVisible();
		await dialog.getByLabel("Comment for the student").fill("Submitted empty");
		await dialog.getByRole("button", { name: "Mark as not graded" }).click();

		await expect(dialog).toBeHidden();
		await expect(answer).toContainText("Not graded");
		await expect(answer).toContainText("Submitted empty");
	});

	await test.step("the queue reads it under not graded", async () => {
		await page.getByRole("link", { name: "← Grading", exact: true }).click();

		await expect(page).toHaveURL(grading);
		const item = page
			.getByRole("list", { name: "Questions" })
			.getByRole("listitem")
			.filter({ hasText: "Typed capital" });
		await expect(item).toContainText("1 pending");
		await expect(item).toContainText("1 graded");
		await expect(item).toContainText("1 not graded");
	});
});

test("instructor: see the whole class's results", async ({ page }) => {
	const teacher = await seedUser({ role: "INSTRUCTOR", username: "classroom" });
	const course = await persistedCourseFactory.create({
		instructor: teacher.username,
	});
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});
	await db.question.create(
		{
			course: course.id,
			slug: "q-short",
			status: "PUBLISHED",
			version: "1",
			question: {
				...capitalShortAnswer,
				id: "q-short",
				title: "Typed capital",
			},
		},
		FULL_ACCESS,
	);
	const people = [
		await seedUser({
			role: "STUDENT",
			username: "cl-caio",
			name: "Caio Nunes",
		}),
		await seedUser({ role: "STUDENT", username: "cl-bia", name: "Bia Lima" }),
		await seedUser({
			role: "STUDENT",
			username: "cl-ana",
			name: "Ana Prado",
		}),
	];
	for (const person of people) {
		await db.enrollment.create(
			{ course: course.id, username: person.username },
			FULL_ACCESS,
		);
	}
	const [caio, bia, ana] = people;

	/// A closed exam answered by `sittings`: each student's score, or none for a student who skipped it.
	async function closedExam(
		slug: string,
		title: string,
		daysAgo: number,
		sittings: Array<[(typeof people)[number] | undefined, string]>,
	) {
		const exam = await persistedExamFactory.create({
			course: course.id,
			slug,
			title,
			type: "EXAM",
			status: "ONGOING",
			questions: [{ slug: "q-short" }],
		});
		for (const [student, score] of sittings) {
			if (!student) continue;
			const response = await db.response.submit(
				{
					course: course.id,
					exam: slug,
					question: "q-short",
					payload: { text: `${student.username} on ${slug}` },
				},
				{ actor: student },
			);
			await db.feedback.create(
				{
					submission: {
						publicId: response.submissions.at(-1)?.publicId ?? "",
					},
					ref: "pass-1",
					score,
					grader: teacher.username,
				},
				FULL_ACCESS,
			);
			await db.response.finish(
				{ course: course.id, exam: slug },
				{ actor: student },
			);
		}
		await prisma.exam.update({
			where: { id: exam.id },
			data: {
				status: "COMPLETED",
				scheduledAt: new Date(Date.now() - daysAgo * 24 * 60 * MINUTE),
			},
		});
	}
	// Ana 80% and Bia 60% on the midterm, Caio missed it; Ana 100% and Caio 50% on the final, Bia missed it.
	await closedExam("midterm", "Midterm exam", 30, [
		[ana, "0.8"],
		[bia, "0.6"],
	]);
	await closedExam("final", "Final exam", 10, [
		[ana, "1"],
		[caio, "0.5"],
	]);
	await logInAs(page, teacher);

	await test.step("the Grades tab of the course opens the class's results", async () => {
		await page.goto(href);
		await expect(page).toHaveURL(href);
		await page.getByRole("tab", { name: "Grades", exact: true }).click();

		await expect(page).toHaveURL(`${href}/grades`);
		await expect(
			page.getByRole("heading", { level: 2, name: "Grades", exact: true }),
		).toBeVisible();
	});

	await test.step("every student is a row and every exam a column, with the class average under each exam", async () => {
		const table = page.getByRole("table", { name: "Grades", exact: true });
		await expect(page.getByRole("rowheader")).toHaveText([
			"Ana Prado",
			"Bia Lima",
			"Caio Nunes",
		]);
		await expect(table.getByRole("columnheader").getByRole("link")).toHaveText([
			"Midterm exam",
			"Final exam",
		]);
		const header = (title: string) =>
			table.getByRole("columnheader").filter({
				has: page.getByRole("link", { name: title, exact: true }),
			});
		await expect(header("Midterm exam")).toContainText("avg 70% · 2 of 3");
		await expect(header("Final exam")).toContainText("avg 75% · 2 of 3");

		const cells = (name: string) =>
			page
				.getByRole("row")
				.filter({
					has: page.getByRole("rowheader", { name, exact: true }),
				})
				.getByRole("cell");
		await expect(cells("Ana Prado")).toHaveText(["80%", "100%"]);
		await expect(cells("Bia Lima")).toHaveText(["60%", "Missed"]);
		await expect(cells("Caio Nunes")).toHaveText(["Missed", "50%"]);
	});

	await test.step("a cell leads to that student's attempt, and back returns to the table", async () => {
		await page
			.getByRole("row")
			.filter({
				has: page.getByRole("rowheader", { name: "Bia Lima", exact: true }),
			})
			.getByRole("cell")
			.first()
			.getByRole("link")
			.click();

		await expect(page).toHaveURL(`${href}/exams/midterm/attempts/cl-bia`);
		await expect(
			page.getByRole("heading", { level: 2, name: "Bia Lima", exact: true }),
		).toBeVisible();

		await page.goBack();

		await expect(page).toHaveURL(`${href}/grades`);
		await expect(
			page.getByRole("heading", { level: 2, name: "Grades", exact: true }),
		).toBeVisible();
	});

	await test.step("a column header leads to the exam", async () => {
		await page
			.getByRole("columnheader")
			.getByRole("link", { name: "Final exam", exact: true })
			.click();

		await expect(page).toHaveURL(`${href}/exams/final`);
		await expect(
			page.getByRole("heading", { name: "Final exam" }).first(),
		).toBeVisible();
	});
});

test("instructor: publish the course's final grades", async ({ page }) => {
	const teacher = await seedUser({ role: "INSTRUCTOR", username: "publisher" });
	const course = await persistedCourseFactory.create({
		instructor: teacher.username,
	});
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});
	const ana = await seedUser({
		role: "STUDENT",
		username: "pub-ana",
		name: "Ana Prado",
	});
	const bia = await seedUser({
		role: "STUDENT",
		username: "pub-bia",
		name: "Bia Lima",
	});
	for (const person of [ana, bia]) {
		await db.enrollment.create(
			{ course: course.id, username: person.username },
			FULL_ACCESS,
		);
	}
	await persistedExamFactory.create({
		course: course.id,
		slug: "midterm",
		title: "Midterm exam",
		type: "EXAM",
		status: "COMPLETED",
		scheduledAt: new Date(Date.now() - 30 * 24 * 60 * MINUTE),
	});
	const opts = { actor: teacher };
	// Created out of position order, so the table has to sort them.
	await db.gradeColumn.create(
		{
			course: course.id,
			slug: "final",
			title: "Final grade",
			kind: "LABEL",
			position: 1,
			values: [
				{ username: ana.username, value: "MS" },
				{ username: bia.username, value: "SS" },
			],
		},
		opts,
	);
	await db.gradeColumn.create(
		{
			course: course.id,
			slug: "assignments",
			title: "Assignments",
			kind: "NUMBER",
			position: 0,
			values: [{ username: ana.username, value: 87.456 }],
		},
		opts,
	);
	const released = async (slug: string) =>
		(await db.gradeColumn.findOne({ course: course.id, slug }, opts))
			?.releasedAt;
	await logInAs(page, teacher);

	const table = page.getByRole("table", { name: "Grades", exact: true });
	const header = (title: string) =>
		table.getByRole("columnheader").filter({ hasText: title });
	const releaseButton = (title: string) =>
		page.getByRole("button", { name: `Release ${title}`, exact: true });
	const dialog = (title: string) =>
		page.getByRole("dialog").filter({
			has: page.getByRole("heading", { name: `Release ${title}?` }),
		});

	await test.step("the pushed columns follow the exams, hidden, with their values", async () => {
		await page.goto(`${href}/grades`);

		await expect(table.getByRole("columnheader")).toContainText([
			"Student",
			"Midterm exam",
			"Assignments",
			"Final grade",
		]);
		for (const title of ["Assignments", "Final grade"]) {
			await expect(header(title)).toContainText("Hidden");
			await expect(releaseButton(title)).toBeVisible();
		}
		await expect(header("Midterm exam")).not.toContainText("Hidden");

		const row = (name: string) =>
			page.getByRole("row").filter({
				has: page.getByRole("rowheader", { name, exact: true }),
			});
		await expect(row("Ana Prado").getByRole("cell").nth(1)).toHaveText("87.46");
		await expect(row("Ana Prado").getByRole("cell").nth(2)).toHaveText("MS");
		await expect(row("Bia Lima").getByRole("cell").nth(1)).toHaveText("");
		await expect(row("Bia Lima").getByRole("cell").nth(2)).toHaveText("SS");
	});

	await test.step("the confirmation counts the students who will see a grade, and Cancel releases nothing", async () => {
		await releaseButton("Final grade").click();
		await expect(dialog("Final grade")).toContainText(
			"2 students will see their grade.",
		);
		await dialog("Final grade")
			.getByRole("button", { name: "Cancel", exact: true })
			.click();
		await expect(dialog("Final grade")).toHaveCount(0);

		await releaseButton("Assignments").click();
		await expect(dialog("Assignments")).toContainText(
			"1 student will see their grade.",
		);
		await dialog("Assignments")
			.getByRole("button", { name: "Cancel", exact: true })
			.click();
		await expect(dialog("Assignments")).toHaveCount(0);

		await expect(header("Assignments")).toContainText("Hidden");
		expect(await released("assignments")).toBeNull();
		expect(await released("final")).toBeNull();
	});

	await test.step("Release publishes that column and leaves the other hidden", async () => {
		await releaseButton("Assignments").click();
		await dialog("Assignments")
			.getByRole("button", { name: "Release", exact: true })
			.click();

		await expect(releaseButton("Assignments")).toHaveCount(0);
		await expect(header("Assignments")).not.toContainText("Hidden");
		await expect(header("Final grade")).toContainText("Hidden");
		await expect(releaseButton("Final grade")).toBeVisible();
		expect(await released("assignments")).toBeInstanceOf(Date);
		expect(await released("final")).toBeNull();
	});

	await test.step("the student's course home lists the released grade only", async () => {
		await page.context().clearCookies();
		await logInAs(page, ana);
		await page.goto(href);

		const list = page.getByRole("list", { name: "Grades", exact: true });
		await expect(list.getByRole("listitem")).toHaveCount(1);
		await expect(list).toContainText("Assignments");
		await expect(list).toContainText("87.46");
		await expect(page.getByText("Final grade")).toHaveCount(0);
	});
});
