import { expect, type Page, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedQuestionFactory } from "@/fixtures/question.factory";
import { courseHref } from "@/urls";
import { decodeIslandProps } from "./helpers/astro-island-props";
import { findRawIdOrHashKeys } from "./helpers/raw-ids";
import { logInAs, resetDatabase, seedUser } from "./stories/helpers";

/**
 * `dev/specs/to-do/actions-no-raw-ids.md`'s island-props guard: every page
 * that hydrates a `client:*` component must serialize only public
 * references into its `astro-island` `props` — no id-shaped key (same
 * exemptions as the REST guard, `test/helpers/raw-ids.ts`) and no key
 * ending in `Hash`.
 *
 * Table-driven over every page this suite found with a `client:` directive
 * in `src/pages` (`grep -rl "client:" src/pages`), plus the admin, profile
 * and getting-started pages the spec names explicitly even though none of
 * them hydrate an island today — a page with zero `astro-island` elements
 * passes vacuously, and stays a guard against one showing up there later.
 */

test.beforeEach(resetDatabase);

interface IslandPage {
	name: string;
	/** Logs in as the right user and returns the URL to visit. */
	setUp: (page: Page) => Promise<string>;
}

const PAGES: IslandPage[] = [
	{
		name: "roster (StudentsTable)",
		setUp: async (page) => {
			const course = await persistedCourseFactory.create();
			await db.enrollment.create(
				{
					course: course.id,
					username: (await seedUser({ role: "STUDENT" })).username,
				},
				FULL_ACCESS,
			);
			await logInAs(page, course.instructor);
			return `${href(course)}/roster`;
		},
	},
	{
		name: "questions index (QuestionsTable)",
		setUp: async (page) => {
			const course = await persistedCourseFactory.create();
			await persistedQuestionFactory.create({ course: course.id });
			await logInAs(page, course.instructor);
			return `${href(course)}/questions`;
		},
	},
	{
		name: "question detail (QuestionPreview)",
		setUp: async (page) => {
			const course = await persistedCourseFactory.create();
			const question = await persistedQuestionFactory.create({
				course: course.id,
				slug: "island-scan-question",
			});
			await logInAs(page, course.instructor);
			return `${href(course)}/questions/${question.slug}`;
		},
	},
	{
		name: "exams index (ExamsTable)",
		setUp: async (page) => {
			const course = await persistedCourseFactory.create();
			await persistedExamFactory.create({ course: course.id });
			await logInAs(page, course.instructor);
			return `${href(course)}/exams`;
		},
	},
	{
		name: "exam detail (ExamQuestionsList)",
		setUp: async (page) => {
			const course = await persistedCourseFactory.create();
			const question = await persistedQuestionFactory.create({
				course: course.id,
				slug: "island-scan-pinned",
			});
			const exam = await persistedExamFactory.create({
				course: course.id,
				status: "ONGOING",
				type: "EXAM",
				questions: [{ slug: question.slug }],
			});
			await logInAs(page, course.instructor);
			return `${href(course)}/exams/${exam.slug}`;
		},
	},
	{
		name: "admin index",
		setUp: async (page) => {
			const admin = await seedUser({ role: "ADMIN" });
			await logInAs(page, admin);
			return "/admin";
		},
	},
	{
		name: "admin users",
		setUp: async (page) => {
			const admin = await seedUser({ role: "ADMIN" });
			await logInAs(page, admin);
			return "/admin/users";
		},
	},
	{
		name: "profile",
		setUp: async (page) => {
			const user = await seedUser({ role: "STUDENT" });
			await logInAs(page, user);
			return "/profile";
		},
	},
	{
		name: "getting-started",
		setUp: async (page) => {
			const user = await seedUser({ role: "STUDENT" });
			await logInAs(page, user);
			return "/getting-started";
		},
	},
	{
		name: "design/questions (question view gallery)",
		setUp: async () => "/design/questions",
	},
];

for (const { name, setUp } of PAGES) {
	test(`${name}: no astro-island props carry a raw id or a *Hash key`, async ({
		page,
	}) => {
		const url = await setUp(page);
		const response = await page.goto(url);
		expect(response?.ok(), `${name} did not load (${url})`).toBe(true);

		const islands = await page.locator("astro-island").evaluateAll((elements) =>
			elements.map((el) => ({
				componentUrl: el.getAttribute("component-url") ?? "<unknown>",
				props: el.getAttribute("props"),
			})),
		);

		const offenses = islands.flatMap(({ componentUrl, props }) => {
			if (!props) return [];
			const decoded = decodeIslandProps(props);
			return findRawIdOrHashKeys(decoded).map(
				(pointer) => `${name} ${componentUrl} ${pointer}`,
			);
		});

		expect(offenses, offenses.join("\n")).toEqual([]);
	});
}

function href(course: {
	discipline: { slug: string };
	instructor: { username: string };
	edition: { slug: string };
}): string {
	return courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});
}
