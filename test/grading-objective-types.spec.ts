import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { brasiliaFillIn, primesSelection, waterNumeric } from "@/mdq/fixtures";
import { courseHref } from "@/urls";
import { expect, test } from "./fixtures";
import { logInAs, resetDatabase, seedUser } from "./stories/helpers";
import { gradesMessage } from "./stories/objective-support";

// The grading page of the question types that the other specs do not render: numeric, fill-in and multiple selection.

test.beforeEach(resetDatabase);

/// The fixed part of a message with a placeholder: "Who missed a blank ({count})" becomes "Who missed a blank".
function heading(key: string): string {
	return (gradesMessage(key).split("{")[0] ?? "").replace(/[\s(]+$/, "");
}

/// The text of a message with its `{number}` filled in.
function numbered(key: string, number: number): string {
	return gradesMessage(key).replace("{number}", String(number));
}

/// A closed exam with a numeric, a fill-in and a multiple-selection question, answered by four students.
async function typedExam(prefix: string) {
	const teacher = await seedUser({
		role: "INSTRUCTOR",
		username: `${prefix}-prof`,
	});
	const course = await persistedCourseFactory.create({
		instructor: teacher.username,
	});
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});
	for (const [slug, question] of [
		["q-numeric", waterNumeric],
		["q-fill", brasiliaFillIn],
		["q-multi", primesSelection],
	] as const) {
		await db.question.create(
			{
				course: course.id,
				slug,
				status: "PUBLISHED",
				version: "1",
				question: { ...question, id: slug, title: slug },
			},
			FULL_ACCESS,
		);
	}
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: "typed-exam",
		title: "Typed exam",
		type: "EXAM",
		status: "ONGOING",
		duration: { hours: 1 },
		questions: [{ slug: "q-numeric" }, { slug: "q-fill" }, { slug: "q-multi" }],
	});

	// Numeric: 1000 twice (key), 998 (inside the tolerance), 500 (outside the window).
	// Fill-in: Bia and Caio pick Rio for the first blank. Multiple selection: 2,3,5 twice (key), 2,3 and 2,4.
	const roster = [
		["ana", "Ana Prado", 1000, "brasilia", ["two", "three", "five"]],
		["bia", "Bia Lima", 1000, "rio", ["two", "three", "five"]],
		["caio", "Caio Nunes", 998, "rio", ["two", "three"]],
		["davi", "Davi Rocha", 500, "brasilia", ["two", "four"]],
	] as const;
	for (const [key, name, amount, capital, picks] of roster) {
		const student = await seedUser({
			role: "STUDENT",
			username: `${prefix}-${key}`,
			name,
		});
		await db.enrollment.create(
			{ course: course.id, username: student.username },
			FULL_ACCESS,
		);
		const answers: [string, unknown][] = [
			["q-numeric", amount],
			["q-fill", { capital, size: 2800000, river: "Central" }],
			["q-multi", [...picks]],
		];
		for (const [question, payload] of answers) {
			await db.response.submit(
				{
					course: course.id,
					exam: exam.slug,
					question,
					payload: payload as never,
				},
				{ actor: student },
			);
		}
		await db.response.finish(
			{ course: course.id, exam: exam.slug },
			{ actor: student },
		);
	}
	await prisma.exam.update({
		where: { id: exam.id },
		data: {
			status: "COMPLETED",
			gradesReleasedAt: new Date(Date.now() - 60_000),
		},
	});
	await expect
		.poll(() =>
			prisma.feedback.count({
				where: { submission: { response: { examId: exam.id } } },
			}),
		)
		.toBe(roster.length * 3);

	const url = (question: string) =>
		`${href}/exams/${exam.slug}/grading/${question}`;
	return { teacher, url };
}

test("a numeric question draws the histogram of the values sent, with one bar per value", async ({
	page,
}) => {
	const world = await typedExam("ot-numeric");
	await logInAs(page, world.teacher);

	await page.goto(world.url("q-numeric"));

	const section = page.locator("section").filter({
		has: page.getByRole("heading", {
			name: heading("grades_objective_section_histogram"),
		}),
	});
	await expect(section).toBeVisible();
	// The bar of 1000 holds two students; 998 and 500 hold one each.
	await expect(section.getByText("2", { exact: true })).toHaveCount(1);
	await expect(section.getByText("1", { exact: true })).toHaveCount(2);
	await expect(section).toContainText("500");
});

test("a fill-in question has a section per blank and lists who missed a blank", async ({
	page,
}) => {
	const world = await typedExam("ot-fill");
	await logInAs(page, world.teacher);

	await page.goto(world.url("q-fill"));

	for (const number of [1, 2, 3]) {
		await expect(
			page.getByRole("heading", {
				name: numbered("grades_objective_blank", number),
			}),
		).toBeVisible();
	}
	// Two students picked Rio on the first blank.
	const first = page.locator("section").filter({
		has: page.getByRole("heading", {
			name: numbered("grades_objective_blank", 1),
		}),
	});
	await expect(
		first.getByRole("row").filter({ hasText: "Rio de Janeiro" }),
	).toContainText("2");
	const missed = page.locator("section").filter({
		has: page.getByRole("heading", {
			name: heading("grades_objective_section_missed"),
		}),
	});
	await expect(missed).toBeVisible();
	await expect(missed).toContainText("Bia Lima");
	await expect(missed).toContainText("Caio Nunes");
	await expect(missed).not.toContainText("Ana Prado");
});

test("a multiple-selection question counts each alternative and the most common combinations", async ({
	page,
}) => {
	const world = await typedExam("ot-multi");
	await logInAs(page, world.teacher);

	await page.goto(world.url("q-multi"));

	const section = (key: string) =>
		page
			.locator("section")
			.filter({ has: page.getByRole("heading", { name: gradesMessage(key) }) });
	const alternatives = section("grades_objective_section_alternatives");
	await expect(alternatives).toBeVisible();
	// "3" was marked by Ana, Bia and Caio.
	await expect(
		alternatives.getByRole("row").filter({ hasText: "B. 3" }),
	).toContainText(/3\s*75\s*%/);
	const combinations = section("grades_objective_section_combinations");
	await expect(combinations).toBeVisible();
	// 2, 3 and 5 was marked twice out of four; the other two combinations once each.
	await expect(
		combinations.getByRole("row").filter({ hasText: /50\s*%/ }),
	).toContainText("2");
	await expect(
		combinations.getByRole("row").filter({ hasText: /25\s*%/ }),
	).toHaveCount(2);
});
