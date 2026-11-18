import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import {
	capitalShortAnswer,
	capitalShortAnswerManual,
	multipleChoice,
	trueFalse,
} from "@/mdq/fixtures";
import { courseHref } from "@/urls";
import { expect, test } from "../fixtures";
import { addExam, adjustableExam, HANA_SCHOOL_ID } from "./adjustment-support";
import { logInAs, resetDatabase, seedUser } from "./helpers";
import {
	CHALLENGE_COMMENT,
	gradesMessage,
	objectiveExam,
	objectiveLabel,
	PARTIAL_COMMENT,
	passesOf,
} from "./objective-support";
import { releasedExam, requestRegrade } from "./regrade-setup";
import { weightedExam } from "./weighted-exam-support";

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
				...capitalShortAnswerManual,
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
				payload: text,
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
		await page.goto(`${grading}/q-short?view=list`);
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
		await page.goto(`${grading}/q-short?view=list`);

		await expect(page).toHaveURL(`${grading}/q-short?view=list`);
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
				...capitalShortAnswerManual,
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
					payload: `${student.username} on ${slug}`,
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

	await test.step("the Students tab leads to the class's results through the course card", async () => {
		await page.goto(href);
		await expect(page).toHaveURL(href);
		await page.getByRole("tab", { name: "Students", exact: true }).click();
		await expect(page).toHaveURL(`${href}/roster`);
		await page
			.locator("[data-course-card]")
			.getByRole("link", { name: "Grades", exact: true })
			.click();

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

test("instructor: find the questions that need rework", async ({ page }) => {
	const teacher = await seedUser({
		role: "INSTRUCTOR",
		username: "ds-teacher",
	});
	const course = await persistedCourseFactory.create({
		instructor: teacher.username,
	});
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});

	const fruit = multipleChoice({
		id: "fruit",
		title: "Best fruit",
		stem: "Pick the best fruit.",
		choices: [
			{ id: "pear", text: "Pear", score: 1 },
			{ id: "apple", text: "Apple", score: 0 },
			{ id: "fig", text: "Fig", score: 0 },
			{ id: "kiwi", text: "Kiwi", score: 0 },
		],
	});
	const protocols = trueFalse({
		id: "protocols",
		title: "Protocols",
		stem: "Judge each statement.",
		choices: [
			{ id: "s1", text: "First statement", correct: true },
			{ id: "s2", text: "Second statement", correct: false },
		],
	});
	for (const [slug, question] of [
		["fruit", fruit],
		["protocols", protocols],
		["trick", { ...capitalShortAnswer, id: "trick", title: "Trick question" }],
	] as const) {
		await db.question.create(
			{
				course: course.id,
				slug,
				status: "PUBLISHED",
				version: "1",
				question,
			},
			FULL_ACCESS,
		);
	}

	const students: Awaited<ReturnType<typeof seedUser>>[] = [];
	for (let i = 0; i < 8; i++) {
		const student = await seedUser({
			role: "STUDENT",
			username: `ds-student-${i}`,
		});
		await db.enrollment.create(
			{ course: course.id, username: student.username },
			FULL_ACCESS,
		);
		students.push(student);
	}

	type Payload = Parameters<typeof db.response.submit>[0]["payload"];

	/// A student answers each `[question, payload, score]`, the teacher grades it, and the attempt is closed.
	async function sit(
		exam: string,
		student: (typeof students)[number],
		rows: Array<[string, Payload, string]>,
	) {
		for (const [question, payload, score] of rows) {
			const response = await db.response.submit(
				{ course: course.id, exam, question, payload },
				{ actor: student },
			);
			await db.feedback.create(
				{
					submission: {
						publicId:
							response.submissions.filter((s) => s.question === question).at(-1)
								?.publicId ?? "",
					},
					ref: "pass-1",
					score,
					grader: teacher.username,
				},
				FULL_ACCESS,
			);
		}
		await db.response.finish({ course: course.id, exam }, { actor: student });
	}

	async function closedExam(slug: string, title: string, questions: string[]) {
		return persistedExamFactory.create({
			course: course.id,
			slug,
			title,
			type: "EXAM",
			status: "ONGOING",
			questions: questions.map((question) => ({
				slug: question,
				// The exam pins the first version of the multiple-choice question.
				version: question === "fruit" ? "1" : undefined,
			})),
		});
	}

	// A small exam: four graded attempts, too few for a discrimination index.
	const small = await closedExam("pop-quiz", "Pop quiz", [
		"fruit",
		"protocols",
	]);
	for (const [i, student] of students.slice(0, 4).entries()) {
		await sit("pop-quiz", student, [
			["fruit", i < 2 ? "pear" : "apple", i < 2 ? "1" : "0"],
			["protocols", { s1: true, s2: false }, "1"],
		]);
	}
	await prisma.exam.update({
		where: { id: small.id },
		data: { status: "COMPLETED" },
	});

	// A large exam: eight attempts. With m = fruit = protocols = [1,1,1,1,0,0,0,0]
	// and b = trick = [0,0,0,1,1,1,1,0], both series have mean 0.5 and sum of
	// squared deviations 2, and sum(dm*db) = -1. So trick against the mean of the
	// other two (= m) correlates at -1/2, while fruit against (protocols + trick)/2
	// has covariance (2 - 1)/2 = .5 and variance .5, giving .5/sqrt(2 * .5) = +0.5.
	const final = await closedExam("final", "Final exam", [
		"fruit",
		"protocols",
		"trick",
	]);
	const fruitChoice = [
		"pear",
		"pear",
		"pear",
		"pear",
		"apple",
		"apple",
		"kiwi",
		"kiwi",
	];
	const protocolAnswers: Record<string, boolean>[] = [
		{ s1: true, s2: false },
		{ s1: true, s2: false },
		{ s1: true, s2: false },
		{ s1: true, s2: false },
		{ s1: false, s2: false },
		{ s1: true, s2: true },
		{ s1: false },
		{ s1: false, s2: true },
	];
	const trickScore = ["0", "0", "0", "1", "1", "1", "1", "0"];
	for (const [i, student] of students.entries()) {
		const strong = i < 4 ? "1" : "0";
		await sit("final", student, [
			["fruit", fruitChoice[i] ?? "", strong],
			["protocols", protocolAnswers[i] ?? {}, strong],
			["trick", `guess ${i}`, trickScore[i] ?? "0"],
		]);
	}
	await prisma.exam.update({
		where: { id: final.id },
		data: { status: "COMPLETED" },
	});

	// A practice exam over the same questions: its answers pick the fig that
	// nobody picked on the real exam, and must not leak into the real counts.
	await persistedExamFactory.create({
		course: course.id,
		slug: "drill",
		title: "Practice drill",
		type: "PRACTICE",
		status: "ONGOING",
		questions: [{ slug: "fruit" }, { slug: "trick" }],
	});
	for (const student of students.slice(0, 5)) {
		await db.response.submit(
			{
				course: course.id,
				exam: "drill",
				question: "fruit",
				payload: "fig",
			},
			{ actor: student },
		);
	}
	await logInAs(page, teacher);

	const table = () =>
		page.getByRole("table", { name: "Question statistics", exact: true });
	const cells = (title: string) =>
		table().getByRole("row").filter({ hasText: title }).locator("td");
	/// The block with the statement and the answer key, apart from the user menu's `<details>`.
	const key = () =>
		page.locator("details").filter({ hasText: "Statement and answer key" });

	await test.step("on the small exam the discrimination is a dash that says why", async () => {
		await page.goto(`${href}/exams/pop-quiz/results`);

		for (const header of ["Blank", "Discrimination"]) {
			await expect(
				table().getByRole("columnheader", { name: header, exact: true }),
			).toBeVisible();
		}
		await expect(cells("Best fruit").nth(5)).toHaveText(/^—/);
		await expect(cells("Protocols").nth(5)).toHaveText(/^—/);
		await expect(
			page.getByTitle("Fewer than 5 graded attempts").first(),
		).toBeVisible();
		await expect(table().getByText("review")).toHaveCount(0);
	});

	await test.step("on the large exam only the question the strong students miss is marked for review", async () => {
		await page.goto(`${href}/exams/final/results`);

		// Question, Answered, Blank, Average, Correct, Discrimination, To grade.
		await expect(cells("Best fruit")).toHaveText([
			/^Q1.*Best fruit/,
			"8",
			"0",
			"50%",
			"50%",
			"0.50",
			"",
		]);
		await expect(cells("Protocols").nth(5)).toHaveText("0.50");
		await expect(cells("Trick question").nth(5)).toContainText("-0.50");
		await expect(cells("Trick question").nth(5)).toContainText("review");
		await expect(table().getByText("review")).toHaveCount(1);
		await expect(
			page.getByText("Discrimination tells how well a question separates", {
				exact: false,
			}),
		).toBeVisible();
	});

	await test.step("the question title opens its grading page, with the answer distribution and the correct choice marked", async () => {
		await table()
			.getByRole("link", { name: "Best fruit", exact: true })
			.click();

		await expect(page).toHaveURL(`${href}/exams/final/grading/fruit?view=list`);
		const summary = page.getByTestId("summary");
		await expect(summary).toContainText("8");
		await expect(summary).toContainText(/50\s*%/);
		const row = (text: string) =>
			page.getByRole("row").filter({ hasText: text });
		await expect(row("Pear")).toContainText("4");
		await expect(row("Pear")).toContainText(/50\s*%/);
		// Only the key carries the in-the-key marker.
		await expect(
			row("Pear").getByLabel(gradesMessage("grades_objective_in_key"), {
				exact: true,
			}),
		).toHaveCount(1);
		await expect(
			row("Apple").getByLabel(gradesMessage("grades_objective_in_key"), {
				exact: true,
			}),
		).toHaveCount(0);
		// Nobody left it blank, so there is no row for that.
		await expect(
			page.getByRole("row").filter({ hasText: "(blank)" }),
		).toHaveCount(0);
		await expect(row("Apple")).toContainText("2");
		await expect(row("Apple")).toContainText(/25\s*%/);
		await expect(row("Fig")).toContainText(/0\s*%/);
		await expect(row("Kiwi")).toContainText("2");
		await expect(row("Kiwi")).toContainText(/25\s*%/);
		await key().locator("summary").click();
		await expect(key()).toContainText(/Pear\s*Correct/);
		await expect(key()).not.toContainText(/Apple\s*Correct/);
	});

	await test.step("the true-false question shows true, false and abstained per statement", async () => {
		await page.goto(`${href}/exams/final/grading/protocols?view=list`);

		const row = (text: string) =>
			page.getByRole("row").filter({ hasText: text });
		await expect(row("First statement")).toContainText("T 5");
		await expect(row("First statement")).toContainText("F 3");
		await expect(row("Second statement")).toContainText("T 2");
		await expect(row("Second statement")).toContainText("F 5");
		// Missed: the two who said true plus the one who left it unanswered.
		await expect(
			page.getByRole("columnheader", {
				name: gradesMessage("grades_objective_count_missed"),
			}),
		).toBeVisible();
		await expect(row("Second statement").locator("td").nth(1)).toHaveText(/^3/);
		await expect(row("First statement").locator("td").nth(1)).toHaveText(/^3/);
	});

	await test.step("a typed question groups identical responses instead of choices", async () => {
		await page.goto(`${href}/exams/final/grading/trick?view=list`);

		await expect(
			page.getByRole("heading", { level: 2, name: "Trick question" }),
		).toBeVisible();
		const groups = page.getByRole("row").filter({ hasText: /13\s*%/ });
		await expect(groups).toHaveCount(8);
		await expect(groups.first()).toContainText("1");
	});

	await test.step("after the question gets a new version the exam still grades against the pinned one", async () => {
		await db.question.update(
			{ course: course.id, slug: "fruit" },
			{
				version: "2",
				question: {
					...fruit,
					stem: "Pick the fruit that grows on trees.",
					choices: [
						{ id: "pear", text: "Pear", score: 0 },
						{ id: "apple", text: "Apple", score: 1 },
						{ id: "fig", text: "Fig", score: 0 },
						{ id: "kiwi", text: "Kiwi", score: 0 },
					],
				},
			},
			FULL_ACCESS,
		);

		await page.goto(`${href}/exams/final/grading/fruit?view=list`);

		// The grouped table still marks the pinned key, not the new version's.
		const inKey = (text: string) =>
			page
				.getByRole("row")
				.filter({ hasText: text })
				.getByLabel(gradesMessage("grades_objective_in_key"), { exact: true });
		await expect(inKey("Pear")).toHaveCount(1);
		await expect(inKey("Apple")).toHaveCount(0);
		await key().locator("summary").click();
		await expect(key()).toContainText("Pick the best fruit.");
		await expect(key()).not.toContainText(
			"Pick the fruit that grows on trees.",
		);
		await expect(key()).toContainText(/Pear\s*Correct/);
		await expect(key()).not.toContainText(/Apple\s*Correct/);
		await expect(page.getByRole("alert")).toHaveCount(0);
	});

	await test.step("a pinned version the question never had warns and falls back to the latest", async () => {
		const ref = await prisma.questionRef.findFirstOrThrow({
			where: { courseId: course.id, slug: "fruit" },
		});
		await prisma.questionsForExam.update({
			where: {
				examId_questionRefId: { examId: final.id, questionRefId: ref.id },
			},
			data: { version: "ghost" },
		});

		await page.goto(`${href}/exams/final/grading/fruit?view=list`);

		await expect(page.getByRole("alert")).toContainText(
			'This exam pins version "ghost", which this question does not have. Showing the latest version instead.',
		);
		await key().locator("summary").click();
		await expect(key()).toContainText("Pick the fruit that grows on trees.");
		await expect(key()).toContainText(/Apple\s*Correct/);
		await expect(key()).not.toContainText(/Pear\s*Correct/);
	});
});

test("instructor: answer regrade requests", async ({ page }) => {
	const world = await releasedExam("rg-prof", 2);
	const [first, second] = world.students;
	if (!first || !second) throw new Error("no students");
	await requestRegrade(world.course, first, first.submission);
	await requestRegrade(world.course, second, second.submission);
	const regrades = `${world.examUrl}/regrades`;
	await logInAs(page, world.teacher);

	await test.step("the home page lists the exam with open requests and opens them", async () => {
		await page.goto("/");

		const queue = page.locator("section").filter({
			has: page.getByRole("heading", { name: "Regrade requests", exact: true }),
		});
		const item = queue.getByRole("link").filter({ hasText: "Regrade exam" });
		await expect(item).toContainText("2 open requests");
		await item.click();

		await expect(page).toHaveURL(regrades);
	});

	await test.step("a student's attempt page marks the open request and links to its card", async () => {
		await page.goto(`${world.examUrl}/attempts/${first.username}`);

		await page.getByRole("link", { name: "Regrade requested" }).click();

		await expect(page).toHaveURL(new RegExp(`${regrades}(#.*)?$`));
		await expect(
			page.getByRole("article").filter({ hasText: first.username }),
		).toBeVisible();
	});

	await test.step("the exam page announces the open requests and links to them", async () => {
		await page.goto(world.examUrl);

		await page.getByRole("link", { name: "2 open regrade requests" }).click();

		await expect(page).toHaveURL(regrades);
		await expect(
			page.getByRole("heading", {
				level: 2,
				name: "Regrade requests",
				exact: true,
			}),
		).toBeVisible();
		await expect(page.getByRole("article")).toHaveCount(2);
	});

	await test.step("a refusal without a reply is rejected and the request stays open", async () => {
		const card = page.getByRole("article").filter({ hasText: first.username });
		await card.getByRole("button", { name: "Reject" }).click();

		await expect(card.getByText("A reply is required.")).toBeVisible();
		await expect(card.getByText("Regrade requested")).toBeVisible();
	});

	await test.step("accepting with a new score and a reply resolves it", async () => {
		const card = page.getByRole("article").filter({ hasText: first.username });
		await card.getByLabel("New score (%)").fill("90");
		await card
			.getByLabel("Reply")
			.fill("You are right, the capital is accepted.");
		await card.getByRole("button", { name: "Accept" }).click();

		await expect(card.getByText("Regrade accepted")).toBeVisible();
		await expect(
			card.getByText("You are right, the capital is accepted."),
		).toBeVisible();
		await expect(card.getByRole("button", { name: "Accept" })).toHaveCount(0);
	});

	await test.step("the grading page marks only the answer whose request is still open", async () => {
		await page.goto(
			`${world.href}/exams/${world.exam.slug}/grading/q-short?view=list`,
		);

		const attention = page.locator("section#attention").getByRole("listitem");
		await expect(attention).toHaveCount(1);
		await expect(attention).toContainText(second.name);
		await expect(attention).toContainText("Regrade requested");
		await expect(page.locator("section#attention")).not.toContainText(
			first.name,
		);
	});

	await test.step("the exam page now announces one open request, and the student sees the new score", async () => {
		await page.goto(world.examUrl);
		await expect(
			page.getByRole("link", { name: "1 open regrade request", exact: true }),
		).toBeVisible();

		await page.context().clearCookies();
		await logInAs(page, first);
		await page.goto(world.examUrl);

		await expect(page.getByText("90%", { exact: true }).first()).toBeVisible();
		await expect(page.getByText("Regrade accepted")).toBeVisible();
	});
});

test("instructor: run a student's code while grading", async ({ page }) => {
	const teacher = await seedUser({ role: "INSTRUCTOR", username: "run-prof" });
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
			slug: "q-double",
			status: "PUBLISHED",
			version: "1",
			question: {
				type: "essay",
				title: "Double it",
				stem: "Read a number and print its double.",
				content: "code",
				highlight: "javascript",
			},
		},
		FULL_ACCESS,
	);
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: "run-exam",
		title: "Run exam",
		type: "EXAM",
		status: "ONGOING",
		questions: [{ slug: "q-double" }],
	});
	const programs = {
		correct: 'console.log(Number(prompt("Number?")) * 2); // correct',
		crash: 'throw new Error("boom"); // crash',
		loop: "while (true) {} // loop",
		reads: 'console.log(prompt("Name?")); // reads',
	};
	for (const [i, code] of Object.values(programs).entries()) {
		const student = await seedUser({
			role: "STUDENT",
			username: `run-student-${i + 1}`,
			name: `Runner Student ${i + 1}`,
		});
		await db.enrollment.create(
			{ course: course.id, username: student.username },
			FULL_ACCESS,
		);
		await db.response.submit(
			{
				course: course.id,
				exam: exam.slug,
				question: "q-double",
				payload: code,
			},
			{ actor: student },
		);
		await db.response.finish(
			{ course: course.id, exam: exam.slug },
			{ actor: student },
		);
	}
	await prisma.exam.update({
		where: { id: exam.id },
		data: { status: "COMPLETED" },
	});
	await logInAs(page, teacher);
	const widgets = page.locator("[data-code-runner][data-mode=review]");
	const widgetOf = (marker: string) => widgets.filter({ hasText: marker });
	const terminal = (marker: string) =>
		widgetOf(marker).locator("[data-terminal] .xterm-accessibility-tree");

	await test.step("the grading page shows each answer highlighted, named by number", async () => {
		// The list view shows every answer; the default view shows one at a time.
		await page.goto(`${href}/exams/${exam.slug}/grading/q-double?view=list`);

		await expect(widgets).toHaveCount(4);
		await expect(page.getByText("Runner Student 1")).toHaveCount(0);
		await expect(widgetOf("// correct").locator(".shiki")).toBeVisible();
	});

	await test.step("a program that asks for input gets it from the terminal", async () => {
		const widget = widgetOf("// correct");
		await widget.scrollIntoViewIfNeeded();
		await expect(
			widget.locator("xpath=ancestor::astro-island"),
		).not.toHaveAttribute("ssr", "");
		await widget.locator("[data-action=run]").click();
		await expect(widget).toHaveAttribute("data-phase", "waiting-input");
		await page.keyboard.type("21");
		await page.keyboard.press("Enter");
		await expect(terminal("// correct")).toContainText("42");
		await expect(widget).toHaveAttribute("data-phase", "done");
	});

	await test.step("an answer that throws shows its error, without touching the others", async () => {
		const widget = widgetOf("// crash");
		await widget.scrollIntoViewIfNeeded();
		await widget.locator("[data-action=run]").click();
		await expect(widget).toHaveAttribute("data-phase", "error");
		await expect(terminal("// crash")).toContainText("boom");
	});

	await test.step("a loop that never ends is cut with Stop", async () => {
		const widget = widgetOf("// loop");
		await widget.scrollIntoViewIfNeeded();
		await widget.locator("[data-action=run]").click();
		await expect(widget).toHaveAttribute("data-phase", "running");
		await widget.locator("[data-action=stop]").click();
		await expect(widget).toHaveAttribute("data-phase", "stopped", {
			timeout: 5000,
		});
	});

	await test.step("an edited copy is marked modified and goes away with Back to submission", async () => {
		// The filter by text stops matching once the copy is edited, so pin the widget by its submission.
		const id = await widgetOf("// crash").getAttribute("data-submission");
		const widget = page.locator(`[data-code-runner][data-submission="${id}"]`);
		await widget.scrollIntoViewIfNeeded();
		await widget.locator("[data-action=edit]").click();
		await widget.locator(".cm-content").fill('console.log("fixed");');
		await expect(widget.locator("[data-role=modified]")).toBeVisible();
		await widget.locator("[data-action=run]").click();
		await expect(
			widget.locator("[data-status] [data-run-modified]"),
		).toBeVisible();
		await expect(
			widget.locator("[data-terminal] .xterm-accessibility-tree"),
		).toContainText("fixed");
		await widget.locator("[data-action=back]").click();
		await expect(widget.locator("[data-role=modified]")).toHaveCount(0);
		await expect(widget.locator(".cm-content")).toContainText("boom");
	});

	await test.step("the arrows move to the next answer with code and focus its Run button", async () => {
		const first = widgets.first();
		await first.scrollIntoViewIfNeeded();
		await expect(first.locator("[data-role=position]")).toHaveText("1 of 4");
		await expect(first.locator("[data-role=review-label]")).toHaveText(
			/^Answer \d$/,
		);
		await first.locator("[data-action=next]").click();

		await expect(widgets.nth(1).locator("[data-action=run]")).toBeFocused();
		await expect(page).toHaveURL(/#answer-/);
		await expect(widgets.nth(1).locator("[data-role=position]")).toHaveText(
			"2 of 4",
		);
		await widgets.nth(1).locator("[data-action=previous]").click();
		await expect(first.locator("[data-action=run]")).toBeFocused();
	});

	await test.step("showing names labels the answers with the students", async () => {
		await page.getByRole("switch", { name: "Show names" }).click();

		await expect(widgets).toHaveCount(4);
		await expect(
			widgets.first().locator("[data-role=review-label]"),
		).toHaveText(/^Runner Student \d$/);
	});

	await test.step("nothing was graded by running", async () => {
		expect(await prisma.feedback.count()).toBe(0);
	});
});

test("instructor: grade an exam whose questions have different weights", async ({
	page,
}) => {
	const world = await weightedExam("wt-prof");
	const { heavy } = await world.closeExam();
	await db.regradeRequest.create(
		{ course: world.course.id, submission: heavy, message: "Check Q1 again." },
		{ actor: world.student },
	);
	await logInAs(page, world.teacher);
	const heavyLabel = /Q1.*75\/100/;

	await test.step("the grading queue labels each question with its number and points", async () => {
		await page.goto(`${world.examUrl}/grading`);

		const items = page.getByRole("listitem");
		await expect(items.filter({ hasText: "Heavy question" })).toContainText(
			/Q1.*75\/100/,
		);
		await expect(items.filter({ hasText: "Light question" })).toContainText(
			/Q2.*25\/100/,
		);
	});

	await test.step("a question's grading page shows them in the heading and the tab title", async () => {
		await page.goto(`${world.examUrl}/grading/q-heavy`);

		await expect(page.getByTestId("question-number")).toHaveText("Q1");
		await expect(page.getByTestId("question-points")).toContainText("75/100");
		await expect(
			page.getByRole("heading", { level: 2, name: "Heavy question" }),
		).toBeVisible();
		await expect(page).toHaveTitle(/^Q1 Heavy question/);
	});

	await test.step("the statistics and the results table use the weighted total", async () => {
		await page.goto(`${world.examUrl}/results`);

		const stats = page.getByRole("row").filter({ hasText: "Heavy question" });
		await expect(stats).toContainText(/Q1.*75\/100/);
		await expect(
			page.getByRole("row").filter({ hasText: "Ana Prado" }),
		).toContainText("25%");
	});

	await test.step("the student's attempt and the regrade requests carry the same labels", async () => {
		await page.goto(`${world.examUrl}/attempts/${world.student.username}`);
		await expect(
			page.getByRole("article", { name: /Question 1/ }),
		).toContainText(heavyLabel);

		await page.goto(`${world.examUrl}/regrades`);
		await expect(page.getByRole("article")).toContainText(/Q1.*75\/100/);
	});
});

/**
 * Interface the steps rely on, by screen. Names are the English messages.
 *
 * `exams/<slug>/attempts/<username>` (also for an enrolled student without an attempt)
 *   - Heading with the student's name; to its right three icon buttons "Sanction",
 *     "Add bonus" and "Student list".
 *   - Nav "Questions" with one link per question, named "Question <n>: <state>", the state
 *     being "correct", "partial", "wrong", "blank", "changed by hand", "pending" or "not graded".
 *   - One article "Question <n>" per question, with the buttons "Change grade", "Sanction
 *     question" and, once the grade was changed by hand, "Undo" and the badge "changed by hand".
 *     A question the student left blank reads "Not answered".
 *   - Section "Grade adjustments" with "Original total <p>%", one line per adjustment (the
 *     `adjustmentLabel` text, then the reason) in order of application, and "Final total <p>%".
 *     A question under a penalty carries the badge of its label, e.g. "Penalty ×0.5".
 *   - Dialog "Add bonus": radios "Add points", "Multiply", "Replace grade", field "Value" (points,
 *     or a percentage), field "Reason", buttons "Cancel" and "Add bonus"; the preview shows the new total.
 *   - Dialog "Sanction": field "% of the grade kept", checkbox "Zero", field "Reason", buttons
 *     "Cancel" and "Sanction". The one of a question is titled "Sanction question" and has the button "Sanction question".
 *   - Dialog of "Change grade": field "Grade (0 to 100)", buttons "Mark as correct", "Save", "Cancel".
 *   - A refusal of the server shows in the dialog as an alert and nothing is saved.
 *   - Dialog "Student list": a search box, and a table with one row per active student: name
 *     (a link to the student's attempt), registration, username, total and situation ("no attempt",
 *     "in progress", "pending", "adjusted" or "submitted"); the search also matches the registration.
 *
 * `exams/<slug>/adjustments`
 *   - Heading "Adjustments", a table "Adjustments" with one row per adjustment, active and revoked
 *     (student, target, the `adjustmentLabel` text, reason, notes, "Active" or "Revoked").
 *   - Button "Adjust students" opens the dialog "Adjust grades": field "Usernames" (one or more, separated
 *     by spaces, commas or lines), radios "Add points", "Multiply", "Replace grade", fields "Value" and
 *     "Reason", buttons "Cancel" and "Adjust". It takes students without an attempt.
 *   - An active row has "Edit" (dialog "Edit adjustment": "Value", "Reason", "Save", "Cancel") and
 *     "Revoke" (dialog "Revoke adjustment": "Revoke adjustment", "Cancel"); a revoked row has neither.
 *
 * `exams/<slug>/results`
 *   - Table "Results" with a checkbox "Select <name>" per row; button "Adjust selected", disabled
 *     while nothing is selected, opens the dialog "Adjust grades" (same fields, "Target" first).
 *   - An adjusted total is an `<ins>` with the final total beside a `<del>` with the original, and
 *     a link "Adjustments" to the exam's adjustments page.
 */
test("instructor: adjust a student's grade", async ({ page }) => {
	const world = await adjustableExam("adjust-ins");
	const { ana, bia, caio, davi, eva, fabio, hana } = world;
	await logInAs(page, world.teacher);

	const attemptUrl = (username: string) =>
		`${world.examUrl}/attempts/${username}`;
	const summary = () => page.getByRole("region", { name: "Grade adjustments" });
	const article = (number: number) =>
		page.getByRole("article", { name: `Question ${number}`, exact: true });
	const results = () =>
		page.getByRole("table", { name: "Results", exact: true });
	const resultRow = (name: string) =>
		results().getByRole("row").filter({ hasText: name });
	const table = () =>
		page.getByRole("table", { name: "Adjustments", exact: true });
	const tableRow = (name: string) =>
		table().getByRole("row").filter({ hasText: name });
	const active = () =>
		db.examAdjustment.findMany(
			{ course: world.course.id, exam: world.exam.slug },
			{ actor: world.teacher },
		);

	/// Adds a bonus of `kind` to the attempt on display, through the dialog; it returns the dialog, still open when the server refuses.
	async function addBonus(
		kind: "Add points" | "Multiply" | "Replace grade",
		value: string,
		reason: string,
	) {
		await page.getByRole("button", { name: "Add bonus", exact: true }).click();
		const dialog = page.getByRole("dialog", { name: "Add bonus" });
		await dialog.getByRole("radio", { name: kind }).check();
		await dialog.getByLabel("Value").fill(value);
		await dialog.getByLabel(/^Reason/).fill(reason);
		await dialog
			.getByRole("button", { name: "Add bonus", exact: true })
			.click();
		return dialog;
	}

	await test.step("a bonus of points on Ana shows the original total, the line and the final total", async () => {
		await page.goto(attemptUrl(ana.username));
		await page.getByRole("button", { name: "Add bonus", exact: true }).click();
		const dialog = page.getByRole("dialog", { name: "Add bonus" });
		await dialog.getByRole("radio", { name: "Add points" }).check();
		await dialog.getByLabel("Value").fill("10");
		await dialog.getByLabel(/^Reason/).fill("Participation");
		await expect(dialog).toContainText("60%");
		await dialog
			.getByRole("button", { name: "Add bonus", exact: true })
			.click();

		await expect(dialog).toBeHidden();
		await expect(summary()).toContainText(/Original total\s*50%/);
		await expect(summary()).toContainText("Bonus +10");
		await expect(summary()).toContainText("Participation");
		await expect(summary()).toContainText(/Final total\s*60%/);
	});

	await test.step("a multiplier and a replacement give the right lines and totals, and a second replacement is refused", async () => {
		await page.goto(attemptUrl(caio.username));
		await addBonus("Multiply", "110", "Curve");
		await expect(summary()).toContainText("Bonus ×1.1");
		await expect(summary()).toContainText(/Original total\s*50%/);
		await expect(summary()).toContainText(/Final total\s*55%/);

		await addBonus("Replace grade", "80", "Project grade");
		await expect(summary()).toContainText(
			/Grade replaced by 80%[\s\S]*Bonus ×1\.1/,
		);
		await expect(summary()).toContainText(/Final total\s*88%/);

		const before = (await active()).length;
		const dialog = await addBonus("Replace grade", "70", "Again");
		await expect(dialog.getByRole("alert")).toContainText(
			"edit the existing one",
		);
		expect(await active()).toHaveLength(before);
		await dialog.getByRole("button", { name: "Cancel" }).click();
		await expect(dialog).toBeHidden();
	});

	await test.step("zeroing the exam gives a total of zero", async () => {
		await page.goto(attemptUrl(davi.username));
		await page.getByRole("button", { name: "Sanction", exact: true }).click();
		const dialog = page.getByRole("dialog", { name: "Sanction", exact: true });
		await dialog.getByLabel("Zero").check();
		await dialog.getByLabel(/^Reason/).fill("Unauthorised consultation");
		await dialog.getByRole("button", { name: "Sanction", exact: true }).click();

		await expect(dialog).toBeHidden();
		await expect(summary()).toContainText(/Original total\s*100%/);
		await expect(summary()).toContainText("Zeroed");
		await expect(summary()).toContainText("Unauthorised consultation");
		await expect(summary()).toContainText(/Final total\s*0%/);
	});

	await test.step("a blank question is graded by hand, the nav marks it, and undo takes it back", async () => {
		await page.goto(attemptUrl(eva.username));
		const nav = page.getByRole("navigation", { name: "Questions" });
		await expect(
			nav.getByRole("link", { name: "Question 4: blank" }),
		).toBeVisible();
		await expect(article(4)).toContainText("Not answered");

		await article(4).getByRole("button", { name: "Change grade" }).click();
		const dialog = page.getByRole("dialog");
		await dialog.getByLabel("Grade (0 to 100)").fill("100");
		await dialog.getByRole("button", { name: "Save", exact: true }).click();

		await expect(
			nav.getByRole("link", { name: "Question 4: changed by hand" }),
		).toBeVisible();
		await expect(article(4)).toContainText("100%");
		await expect(article(4)).toContainText("changed by hand");

		await article(4).getByRole("button", { name: "Undo" }).click();
		await expect(
			nav.getByRole("link", { name: "Question 4: blank" }),
		).toBeVisible();
		await expect(article(4)).not.toContainText("changed by hand");
		await expect(
			nav.getByRole("link", { name: "Question 4: changed by hand" }),
		).toHaveCount(0);
	});

	await test.step("the hammer on a question keeps half of it, with the badge and a smaller total", async () => {
		await page.goto(attemptUrl(fabio.username));
		await article(1).getByRole("button", { name: "Sanction question" }).click();
		const dialog = page.getByRole("dialog", { name: /Sanction question/ });
		await dialog.getByLabel("% of the grade kept").fill("50");
		await dialog.getByLabel(/^Reason/).fill("Copied from a neighbour");
		await dialog
			.getByRole("button", { name: "Sanction question", exact: true })
			.click();

		await expect(dialog).toBeHidden();
		await expect(article(1)).toContainText("Penalty ×0.5");
		await expect(article(2)).not.toContainText("Penalty");

		await page.goto(`${world.examUrl}/results`);
		await expect(resultRow("Fabio Reis").getByRole("deletion")).toHaveText(
			"100%",
		);
		await expect(resultRow("Fabio Reis").getByRole("insertion")).toHaveText(
			"88%",
		);
	});

	await test.step("the student list finds a student by registration and opens one without an attempt", async () => {
		await page.goto(attemptUrl(bia.username));
		await page.getByRole("button", { name: "Student list" }).click();
		const dialog = page.getByRole("dialog");
		await expect(
			dialog.getByRole("row").filter({ hasText: "Bia Lima" }),
		).toBeVisible();

		await dialog.getByRole("searchbox").fill(HANA_SCHOOL_ID);
		const hanaRow = dialog.getByRole("row").filter({ hasText: "Hana Souza" });
		await expect(hanaRow).toBeVisible();
		await expect(hanaRow).toContainText(/no attempt/i);
		await expect(
			dialog.getByRole("row").filter({ hasText: "Bia Lima" }),
		).toHaveCount(0);

		await hanaRow.getByRole("link", { name: "Hana Souza" }).click();
		await expect(page).toHaveURL(attemptUrl(hana.username));
		await expect(
			page.getByRole("heading", { name: "Hana Souza" }),
		).toBeVisible();
		await expect(
			page.getByRole("article", { name: /^Question \d/ }),
		).toHaveCount(4);
	});

	await test.step("the adjustments page adjusts in batch a student without an attempt, edits it and revokes it", async () => {
		await page.goto(`${world.examUrl}/adjustments`);
		await expect(
			page.getByRole("heading", { name: "Adjustments", exact: true }),
		).toBeVisible();
		await expect(tableRow("Ana Prado")).toContainText("Bonus +10");
		await expect(tableRow("Ana Prado")).toContainText("Active");

		await page.getByRole("button", { name: "Adjust students" }).click();
		const dialog = page.getByRole("dialog", { name: "Adjust grades" });
		await dialog.getByLabel("Usernames").fill(hana.username);
		await dialog.getByRole("radio", { name: "Replace grade" }).check();
		await dialog.getByLabel("Value").fill("80");
		await dialog.getByLabel(/^Reason/).fill("Project grade stands in");
		await dialog.getByRole("button", { name: "Adjust", exact: true }).click();

		await expect(dialog).toBeHidden();
		await expect(tableRow("Hana Souza")).toContainText("Grade replaced by 80%");
		await expect(tableRow("Hana Souza")).toContainText(
			"Project grade stands in",
		);
		await expect(tableRow("Hana Souza")).toContainText("Active");

		await tableRow("Hana Souza").getByRole("button", { name: "Edit" }).click();
		const edit = page.getByRole("dialog", { name: "Edit adjustment" });
		await expect(edit.getByLabel("Value")).toHaveValue("80");
		await edit.getByLabel("Value").fill("90");
		await edit.getByRole("button", { name: "Save" }).click();
		await expect(edit).toBeHidden();
		await expect(tableRow("Hana Souza")).toContainText("Grade replaced by 90%");

		await tableRow("Hana Souza")
			.getByRole("button", { name: "Revoke" })
			.click();
		const revoke = page.getByRole("dialog", { name: "Revoke adjustment" });
		await revoke
			.getByRole("button", { name: "Revoke adjustment", exact: true })
			.click();
		await expect(revoke).toBeHidden();
		await expect(tableRow("Hana Souza")).toContainText("Revoked");
		await expect(tableRow("Hana Souza")).toContainText("Grade replaced by 90%");
		await expect(tableRow("Hana Souza").getByRole("button")).toHaveCount(0);
		await expect(tableRow("Ana Prado")).toContainText("Active");
	});

	await test.step("the results adjust the selected students and show each original total struck through beside the final one", async () => {
		await page.goto(`${world.examUrl}/results`);
		await expect(
			page.getByRole("button", { name: "Adjust selected" }),
		).toBeDisabled();

		await resultRow("Bia Lima")
			.getByRole("checkbox", { name: "Select Bia Lima" })
			.check();
		await resultRow("Eva Tavares")
			.getByRole("checkbox", { name: "Select Eva Tavares" })
			.check();
		await page.getByRole("button", { name: "Adjust selected" }).click();
		const dialog = page.getByRole("dialog", { name: "Adjust grades" });
		await expect(dialog.getByText("2 students selected")).toBeVisible();
		await dialog.getByRole("radio", { name: "Add points" }).check();
		await dialog.getByLabel("Value").fill("5");
		await dialog.getByLabel(/^Reason/).fill("Extra credit");
		await dialog.getByRole("button", { name: "Adjust", exact: true }).click();
		await expect(dialog).toBeHidden();

		const struck: [string, string, string][] = [
			["Ana Prado", "50%", "60%"],
			["Bia Lima", "75%", "80%"],
			["Caio Nunes", "50%", "88%"],
			["Davi Rocha", "100%", "0%"],
			["Eva Tavares", "75%", "80%"],
			["Fabio Reis", "100%", "88%"],
		];
		for (const [name, original, final] of struck) {
			await expect(resultRow(name).getByRole("deletion")).toHaveText(original);
			await expect(resultRow(name).getByRole("insertion")).toHaveText(final);
			await expect(
				resultRow(name).getByRole("link", { name: "Adjustments" }),
			).toHaveAttribute("href", `${world.examUrl}/adjustments`);
		}
		// Hana's replacement was revoked: nothing is struck through for her.
		await expect(resultRow("Hana Souza").getByRole("deletion")).toHaveCount(0);
	});
});

/**
 * Screen contract for the story below, beyond the pages named in "instructor: adjust a student's grade":
 *
 * - On the page of a student with no attempt every question reads "Not answered", and the summary
 *   "Grade adjustments" lists the adjustments as for any attempt.
 * - The navigation of the exam has a link "Adjustments" followed by the number of active adjustments.
 * - A refusal of the adjustment dialog is an alert that carries the message of the server: for a
 *   student whose own window has not closed, `The exam has not closed for "<username>" yet`; for
 *   a username that is not enrolled, `"<username>" is not enrolled in this course`.
 * - A practice exam has no "Add bonus" and no "Sanction" on a student's page and no "Adjustments" link.
 */
test("instructor: grade a student who did not take the exam", async ({
	page,
}) => {
	const world = await adjustableExam("gap");
	const { davi, hana } = world;
	const iris = await seedUser({
		role: "STUDENT",
		username: "gap-iris",
		name: "Iris Moraes",
	});
	const kai = await seedUser({
		role: "STUDENT",
		username: "gap-kai",
		name: "Kai Duarte",
	});
	const jade = await seedUser({
		role: "STUDENT",
		username: "gap-jade",
		name: "Jade Prates",
	});
	for (const student of [iris, kai]) {
		await db.enrollment.create(
			{ course: world.course.id, username: student.username },
			FULL_ACCESS,
		);
	}
	// The window closed for the class two hours ago; Iris has a makeup date two days ahead.
	await prisma.exam.update({
		where: { id: world.exam.id },
		data: {
			status: "SCHEDULED",
			scheduledAt: new Date(Date.now() - 180 * MINUTE),
			durationMs: 60 * MINUTE,
		},
	});
	await db.examException.create(
		{
			course: world.course.id,
			exam: world.exam.slug,
			username: iris.username,
			scheduledAt: new Date(Date.now() + 2 * 24 * 60 * MINUTE),
		},
		FULL_ACCESS,
	);
	await logInAs(page, world.teacher);

	const adjustmentsUrl = `${world.examUrl}/adjustments`;
	const summary = () => page.getByRole("region", { name: "Grade adjustments" });
	const results = () =>
		page.getByRole("table", { name: "Results", exact: true });
	const table = () =>
		page.getByRole("table", { name: "Adjustments", exact: true });
	/// What the database holds that a refused adjustment must leave alone.
	const stored = async () => ({
		adjustments: await prisma.examAdjustment.count(),
		attempts: await prisma.response.count(),
	});

	/// Opens "Adjust students" on the adjustments page and submits a replacement of 70% for `usernames`; it returns the dialog.
	async function adjustBatch(usernames: string[]) {
		await page.goto(adjustmentsUrl);
		await page.getByRole("button", { name: "Adjust students" }).click();
		const dialog = page.getByRole("dialog", { name: "Adjust grades" });
		await dialog.getByLabel("Usernames").fill(usernames.join(" "));
		await dialog.getByRole("radio", { name: "Replace grade" }).check();
		await dialog.getByLabel("Value").fill("70");
		await dialog
			.getByLabel(/^Reason/)
			.fill("Project grade replaces the second exam");
		await dialog.getByRole("button", { name: "Adjust", exact: true }).click();
		return dialog;
	}

	await test.step("the batch for a student who took the exam and one who did not lists two active adjustments and counts them in the navigation", async () => {
		const dialog = await adjustBatch([davi.username, hana.username]);
		await expect(dialog).toBeHidden();

		await expect(
			table().getByRole("row").filter({ hasText: "Active" }),
		).toHaveCount(2);
		await expect(
			page
				.getByRole("listitem")
				.filter({ hasText: /^Adjustments\s*2$/ })
				.first(),
		).toBeVisible();
		await page.goto(`${world.examUrl}/results`);
		await expect(
			results()
				.getByRole("row")
				.filter({ hasText: "Hana Souza" })
				.getByRole("insertion"),
		).toHaveText("70%");
	});

	await test.step("the page of the student without an attempt shows every question unanswered and the replacement applied", async () => {
		await page.goto(`${world.examUrl}/attempts/${hana.username}`);

		await expect(
			page.getByRole("article", { name: /^Question \d/ }),
		).toHaveCount(4);
		await expect(
			page.getByRole("article", { name: /^Question \d/ }).filter({
				hasText: "Not answered",
			}),
		).toHaveCount(4);
		await expect(summary()).toContainText("Grade replaced by 70%");
		await expect(summary()).toContainText(/Final total\s*70%/);
	});

	await test.step("a second adjustment uses the same empty attempt and the student keeps one row in the results", async () => {
		const before = await stored();
		await page.getByRole("button", { name: "Add bonus", exact: true }).click();
		const dialog = page.getByRole("dialog", { name: "Add bonus" });
		await dialog.getByRole("radio", { name: "Add points" }).check();
		await dialog.getByLabel("Value").fill("10");
		await dialog.getByLabel(/^Reason/).fill("Participation");
		await dialog
			.getByRole("button", { name: "Add bonus", exact: true })
			.click();

		await expect(dialog).toBeHidden();
		await expect(summary()).toContainText(/Final total\s*80%/);
		expect(await stored()).toEqual({
			adjustments: before.adjustments + 1,
			attempts: before.attempts,
		});
		await page.goto(`${world.examUrl}/results`);
		const row = results().getByRole("row").filter({ hasText: "Hana Souza" });
		await expect(row).toHaveCount(1);
		await expect(row.getByRole("insertion")).toHaveText("80%");
	});

	await test.step("a student whose own window has not opened is refused and nothing is written", async () => {
		const before = await stored();
		const dialog = await adjustBatch([iris.username]);

		await expect(dialog.getByRole("alert")).toContainText(
			`The exam has not closed for "${iris.username}" yet`,
		);
		expect(await stored()).toEqual(before);
	});

	await test.step("one username that is not enrolled rejects the whole batch", async () => {
		const before = await stored();
		const dialog = await adjustBatch([kai.username, jade.username]);

		await expect(dialog.getByRole("alert")).toContainText(
			`"${jade.username}" is not enrolled in this course`,
		);
		expect(await stored()).toEqual(before);
	});

	await test.step("a practice exam offers no adjustment and the service refuses one", async () => {
		const practice = await addExam(world, "practice-gap", ["q-one"], {
			type: "PRACTICE",
		});
		const before = await stored();
		await page.goto(
			`${world.href}/exams/${practice.slug}/attempts/${hana.username}`,
		);

		await expect(
			page.getByRole("button", { name: "Student list" }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Add bonus", exact: true }),
		).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: "Sanction", exact: true }),
		).toHaveCount(0);
		await expect(page.getByRole("link", { name: /^Adjustments/ })).toHaveCount(
			0,
		);
		await expect(
			db.examAdjustment.create(
				{
					course: world.course.id,
					exam: practice.slug,
					usernames: [hana.username],
					op: "OFFSET",
					value: "0.1",
					reason: "No practice grade",
				},
				{ actor: world.teacher },
			),
		).rejects.toThrow();
		expect(await stored()).toEqual(before);
	});
});

/**
 * Screen contract for the story below:
 *
 * - The "Student list" dialog has a table whose headers "Student", "Registration", "Username", "Total"
 *   and "Status" are buttons that sort the rows, ascending on the first click and descending on the
 *   second (`aria-sort`); a student without a registration shows "—" in it.
 * - On a student's page, "Previous student" and "Next student" links lead to the neighbours in the
 *   order of the list by name.
 * - The bar of questions is a navigation "Questions" with a link `Q<n>` to `#question-<n>`.
 */
test("instructor: find a student in a large class", async ({ page }) => {
	const world = await adjustableExam("find");
	const { ana, bia, caio, eva, hana } = world;
	// Eva has no registration (the column stores `!<username>` for that); Caio's total is adjusted.
	await prisma.user.update({
		where: { username: eva.username },
		data: { schoolId: `!${eva.username}` },
	});
	await db.examAdjustment.create(
		{
			course: world.course.id,
			exam: world.exam.slug,
			usernames: [caio.username],
			op: "OFFSET",
			value: "0.1",
			reason: "Participation",
		},
		{ actor: world.teacher },
	);
	await logInAs(page, world.teacher);
	const attemptUrl = (username: string) =>
		`${world.examUrl}/attempts/${username}`;
	const heading = (name: string) => page.getByRole("heading", { name });

	/// The rows of the open student list, header excluded.
	const listRows = () =>
		page
			.getByRole("dialog")
			.getByRole("row")
			.filter({ has: page.getByRole("link") });
	const header = (name: string) =>
		page.getByRole("dialog").getByRole("columnheader", { name });

	await page.goto(attemptUrl(ana.username));
	await page.getByRole("button", { name: "Student list" }).click();

	await test.step("a student without a registration shows a dash and is found by name", async () => {
		await page.getByRole("dialog").getByRole("searchbox").fill("Eva");

		await expect(listRows()).toHaveCount(1);
		await expect(listRows().first()).toContainText("Eva Tavares");
		await expect(listRows().first()).toContainText("—");
		await page.getByRole("dialog").getByRole("searchbox").fill("");
		await expect(listRows()).toHaveCount(7);
	});

	await test.step("sorting by total puts the lowest first, then the highest first", async () => {
		await header("Total").getByRole("button").click();
		await expect(header("Total")).toHaveAttribute("aria-sort", "ascending");
		await expect(listRows().first()).toContainText("50%");

		await header("Total").getByRole("button").click();
		await expect(header("Total")).toHaveAttribute("aria-sort", "descending");
		await expect(listRows().first()).toContainText("100%");
	});

	await test.step("sorting by status groups the students without an attempt, the adjusted and the submitted", async () => {
		await header("Status").getByRole("button").click();
		await expect(header("Status")).toHaveAttribute("aria-sort", "ascending");
		await expect(listRows().first()).toContainText("Hana Souza");
		await expect(listRows().first()).toContainText(/no attempt/i);
		await expect(listRows().nth(1)).toContainText("Caio Nunes");
		await expect(listRows().nth(1)).toContainText(/adjusted/i);
		await expect(listRows().last()).toContainText(/submitted/i);

		await header("Status").getByRole("button").click();
		await expect(header("Status")).toHaveAttribute("aria-sort", "descending");
		await expect(listRows().first()).toContainText(/submitted/i);
		await expect(listRows().last()).toContainText("Hana Souza");
	});

	await test.step("the arrows go to the neighbour before and after, in the order of the list", async () => {
		await page.goto(attemptUrl(bia.username));

		await page.getByRole("link", { name: "Next student" }).click();
		await expect(page).toHaveURL(attemptUrl(caio.username));
		await expect(heading("Caio Nunes")).toBeVisible();

		await page.getByRole("link", { name: "Previous student" }).click();
		await expect(page).toHaveURL(attemptUrl(bia.username));
		await page.getByRole("link", { name: "Previous student" }).click();
		await expect(page).toHaveURL(attemptUrl(ana.username));
		await expect(heading("Ana Prado")).toBeVisible();
	});

	await test.step("a click on Q7 in the bar leads to question 7 of a long exam", async () => {
		const questions = Array.from({ length: 8 }, (_, i) => `long-q${i + 1}`);
		const long = await addExam(world, "long-exam", questions);
		await page.goto(
			`${world.href}/exams/${long.slug}/attempts/${hana.username}`,
		);
		const bar = page.getByRole("navigation", { name: "Questions" });
		await expect(bar.getByRole("link")).toHaveCount(8);

		await bar.getByRole("link", { name: /^Question 7/ }).click();

		await expect(page).toHaveURL(/#question-7$/);
		await expect(
			page.getByRole("article", { name: "Question 7", exact: true }),
		).toBeInViewport();
		await expect(bar).toBeInViewport();
	});
});

test("instructor: review an automatically graded question", async ({
	page,
}) => {
	const world = await objectiveExam("ro");
	const grade = (pass: { score: number }[]) => pass.at(-1)?.score;
	await logInAs(page, world.teacher);
	await page.goto(world.choiceUrl);

	const summary = page.getByTestId("summary");
	const attention = page.locator("section#attention");
	const overrides = page.locator("section#overrides");
	const row = (text: string) => page.getByRole("row").filter({ hasText: text });

	await test.step("the summary counts the answers and the share that got it right, with nothing left without a grade", async () => {
		await expect(summary).toContainText("4");
		await expect(summary).toContainText(/25\s*%/);
		await expect(page.locator('a[href="#attention"]')).toHaveCount(0);
	});

	await test.step("the key sits in a closed block that opens on demand", async () => {
		const key = page
			.locator("details")
			.filter({ hasText: "Which city is the capital of Brazil?" });
		await expect(key).not.toHaveAttribute("open", "");
		await key.locator("summary").click();
		await expect(key).toContainText("Which city is the capital of Brazil?");
	});

	await test.step("needs attention lists the open regrade request", async () => {
		await expect(attention.getByRole("listitem")).toHaveCount(1);
		const contested = attention
			.getByRole("listitem")
			.filter({ hasText: "Bia Lima" });
		await expect(contested).toContainText(objectiveLabel("regrade"));
		await expect(
			contested.getByRole("link", { name: objectiveLabel("view_request") }),
		).toHaveAttribute("href", new RegExp(`${world.regradesUrl}(#.*)?$`));
	});

	await test.step("identical answers are grouped, one row per alternative, and a wrong one chosen by who does well elsewhere is flagged", async () => {
		const rio = row("Rio de Janeiro");
		await expect(rio).toContainText("3");
		await expect(rio).toContainText(/75\s*%/);
		await expect(rio).toContainText(objectiveLabel("varies"));
		await expect(rio).toContainText(objectiveLabel("review"));
		const brasilia = row("Brasília");
		await expect(brasilia).toContainText(/25\s*%/);
		await expect(brasilia).toContainText(/100\s*%/);
		await expect(brasilia).toContainText("–");
		await expect(brasilia).not.toContainText(objectiveLabel("review"));
		await expect(row("São Paulo")).toContainText("0");
	});

	await test.step("answers changed by hand are listed apart with the automatic grade struck through", async () => {
		await expect(overrides.getByRole("heading")).toContainText("(1)");
		const ana = overrides.getByRole("row").filter({ hasText: "Ana Prado" });
		await expect(ana).toContainText(/50\s*%/);
		await expect(ana).toContainText(PARTIAL_COMMENT);
		await expect(ana.locator("s, del, .line-through")).toContainText(/0\s*%/);
		await expect(
			ana.getByRole("button", { name: objectiveLabel("change_grade") }),
		).toBeVisible();
	});

	await test.step("the people button opens the students of a group, by name, and a pencil marks one as right", async () => {
		await row("Rio de Janeiro").getByRole("button").click();
		const dialog = page.getByRole("dialog");
		await expect(dialog).toBeVisible();
		for (const name of ["Ana Prado", "Bia Lima", "Davi Rocha"]) {
			await expect(dialog).toContainText(name);
		}
		await expect(dialog).not.toContainText("Caio Nunes");

		await dialog
			.getByRole("row")
			.filter({ hasText: "Bia Lima" })
			.getByRole("button", { name: objectiveLabel("change_grade") })
			.click();
		await dialog.getByRole("textbox").fill(CHALLENGE_COMMENT);
		await dialog
			.getByRole("button", { name: objectiveLabel("mark_correct") })
			.click();

		await expect(overrides.getByRole("heading")).toContainText("(2)");
		const bia = overrides.getByRole("row").filter({ hasText: "Bia Lima" });
		await expect(bia).toContainText(/100\s*%/);
		await expect(bia).toContainText(CHALLENGE_COMMENT);
		await expect(summary).toContainText(/50\s*%/);
		const passes = await passesOf(world.bia.submission);
		expect(passes).toHaveLength(2);
		expect(passes.at(-1)).toMatchObject({
			score: 1,
			grader: world.teacher.username,
			comment: CHALLENGE_COMMENT,
		});
	});

	await test.step("a student already at 100% gets 'mark as wrong', and saving the same grade is disabled", async () => {
		await row("Brasília").getByRole("button").click();
		const dialog = page.getByRole("dialog");
		await dialog
			.getByRole("row")
			.filter({ hasText: "Caio Nunes" })
			.getByRole("button", { name: objectiveLabel("change_grade") })
			.click();
		await expect(
			dialog.getByRole("button", { name: objectiveLabel("mark_wrong") }),
		).toBeVisible();
		await expect(
			dialog.getByRole("button", { name: objectiveLabel("mark_correct") }),
		).toHaveCount(0);
		const save = dialog.getByRole("button", {
			name: gradesMessage("grades_objective_save"),
			exact: true,
		});
		await expect(save).toBeDisabled();
		await dialog.getByRole("spinbutton").fill("90");
		await expect(save).toBeEnabled();
		await page.keyboard.press("Escape");
	});

	await test.step("undo takes the automatic grade back, keeps the history and empties the list at the end", async () => {
		await overrides
			.getByRole("row")
			.filter({ hasText: "Bia Lima" })
			.getByRole("button", { name: objectiveLabel("undo") })
			.click();
		await expect(overrides.getByRole("heading")).toContainText("(1)");
		await expect(summary).toContainText(/25\s*%/);
		const bia = await passesOf(world.bia.submission);
		expect(bia).toHaveLength(3);
		expect(bia.at(-1)?.ref).toMatch(/^revert-/);
		expect(grade(bia)).toBe(0);

		await overrides
			.getByRole("row")
			.filter({ hasText: "Ana Prado" })
			.getByRole("button", { name: objectiveLabel("undo") })
			.click();
		await expect(overrides).toHaveCount(0);
		const ana = await passesOf(world.ana.submission);
		expect(ana).toHaveLength(3);
		expect(ana.at(-1)?.ref).toMatch(/^revert-/);
		expect(grade(ana)).toBe(0);
	});

	await test.step("the edit button leads to the question and the page carries the note about pinned versions", async () => {
		await expect(
			page.getByRole("link", { name: objectiveLabel("edit_question") }),
		).toHaveAttribute("href", new RegExp(`${world.href}/questions/q-choice`));
		await expect(page.getByRole("note")).toBeVisible();
	});
});
