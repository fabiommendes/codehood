import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { capitalShortAnswer, multipleChoice, trueFalse } from "@/mdq/fixtures";
import { courseHref } from "@/urls";
import { logInAs, resetDatabase, seedUser } from "./helpers";
import { releasedExam, requestRegrade } from "./regrade-setup";

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
	const distribution = () =>
		page.getByRole("region", { name: "Answer distribution", exact: true });

	await test.step("on the small exam the discrimination is a dash that says why", async () => {
		await page.goto(`${href}/exams/pop-quiz`);

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
		await page.goto(`${href}/exams/final`);

		// Question, Answered, Blank, Average, Correct, Discrimination, To grade.
		await expect(cells("Best fruit")).toHaveText([
			"Best fruit",
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

		await expect(page).toHaveURL(`${href}/exams/final/grading/fruit`);
		await expect(
			distribution().getByRole("heading", { name: "Answer distribution" }),
		).toBeVisible();
		const rows = distribution().getByRole("listitem");
		await expect(rows).toHaveText([/Pear/, /Apple/, /Fig/, /Kiwi/, /Blank/]);
		await expect(rows.nth(0)).toContainText(/4\D+50%/);
		await expect(rows.nth(1)).toContainText(/2\D+25%/);
		await expect(rows.nth(2)).toContainText(/0\D+0%/);
		await expect(rows.nth(3)).toContainText(/2\D+25%/);
		await expect(rows.nth(4)).toContainText(/0\D+0%/);
		await expect(distribution().getByText("Correct choice")).toHaveCount(1);
		await expect(rows.nth(0).getByText("Correct choice")).toBeVisible();
	});

	await test.step("the true-false question shows true, false and abstained per statement", async () => {
		await page.goto(`${href}/exams/final/grading/protocols`);

		const rows = distribution().getByRole("listitem");
		await expect(rows).toHaveCount(2);
		await expect(rows.nth(0)).toContainText("First statement");
		await expect(rows.nth(0)).toContainText(/True\D*5/);
		await expect(rows.nth(0)).toContainText(/False\D*3/);
		await expect(rows.nth(0)).toContainText(/Abstained\D*0/);
		await expect(rows.nth(0).getByText("Correct answer: True")).toBeVisible();
		await expect(rows.nth(1)).toContainText("Second statement");
		await expect(rows.nth(1)).toContainText(/True\D*2/);
		await expect(rows.nth(1)).toContainText(/False\D*5/);
		await expect(rows.nth(1)).toContainText(/Abstained\D*1/);
		await expect(rows.nth(1).getByText("Correct answer: False")).toBeVisible();
	});

	await test.step("a question without a distribution shows none", async () => {
		await page.goto(`${href}/exams/final/grading/trick`);

		await expect(
			page.getByRole("heading", { level: 2, name: "Trick question" }),
		).toBeVisible();
		await expect(distribution()).toHaveCount(0);
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

		await page.goto(`${href}/exams/final/grading/fruit`);

		await expect(page.getByText("Pick the best fruit.").first()).toBeVisible();
		await expect(
			page.getByText("Pick the fruit that grows on trees."),
		).toHaveCount(0);
		await expect(distribution().getByText("Correct choice")).toHaveCount(1);
		await expect(
			distribution().getByRole("listitem").nth(0).getByText("Correct choice"),
		).toBeVisible();
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

		await page.goto(`${href}/exams/final/grading/fruit`);

		await expect(page.getByRole("alert")).toContainText(
			'This exam pins version "ghost", which this question does not have. Showing the latest version instead.',
		);
		await expect(
			page.getByText("Pick the fruit that grows on trees.").first(),
		).toBeVisible();
		await expect(
			distribution().getByRole("listitem").nth(1).getByText("Correct choice"),
		).toBeVisible();
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
		await page.goto(`${world.href}/exams/${world.exam.slug}/grading/q-short`);

		await expect(page.getByText("Regrade requested")).toHaveCount(1);
		await expect(
			page.getByRole("article").filter({ hasText: "Reply number 2" }),
		).toContainText("Regrade requested");
		await expect(
			page.getByRole("article").filter({ hasText: "Reply number 1" }),
		).not.toContainText("Regrade requested");
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
