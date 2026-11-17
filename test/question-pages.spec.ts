import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { InvalidData } from "@/core/error";
import type { CourseId } from "@/core/schemas/base";
import type { Page } from "@/core/schemas/page";
import type { QuestionSort, QuestionSortField } from "@/core/schemas/question";
import { db } from "@/db";
import { prisma } from "@/db/client";
import type {
	Question,
	QuestionPageFilter,
} from "@/db/services/question.service";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedUserFactory } from "@/fixtures/user.factory";
import {
	decodeKeyCursor,
	encodeCursor,
	encodeKeyCursor,
	pairWhere,
	scanDirection,
} from "@/utils/cursor";

/**
 * The question bank read one page at a time, in any of its orders. Every
 * expectation is computed from the rows of a course made for the test, which
 * repeat statuses, types, titles and update times so that the row id has to
 * break the ties.
 */

const opts = FULL_ACCESS;

/// Status, type, title and tags of the questions of the bank, by slug.
const BANK = [
	["q-01", "DRAFT", "essay", "Trees", ["graphs", "trees"]],
	["q-02", "PUBLISHED", "multiple-choice", "Arrays", ["arrays"]],
	["q-03", "DRAFT", "essay", "Trees", []],
	["q-04", "HIDDEN", "multiple-choice", "arrays in lower case", ["arrays"]],
	["q-05", "DRAFT", "multiple-choice", "Queues", ["queues"]],
	["q-06", "PUBLISHED", "essay", "Trees", ["trees"]],
	["q-07", "ARCHIVED", "essay", "Heaps", []],
] as const;

/// The update time of each question of the bank, in order: three of them share one.
const UPDATED = [5, 3, 3, 9, 3, 1, 7].map(
	(day) => new Date(Date.UTC(2026, 0, day)),
);

type Row = { id: number; slug: string } & Record<
	QuestionSortField,
	string | number
>;

/// Makes a course with the questions of `BANK` and returns what each one is ordered by.
async function makeBank(): Promise<{ course: CourseId; rows: Row[] }> {
	const { id: course } = await persistedCourseFactory.create();
	const rows: Row[] = [];
	for (const [index, [slug, status, type, title, tags]] of BANK.entries()) {
		const created = await db.question.create(
			{
				course,
				slug,
				status,
				version: "v1",
				question:
					type === "essay"
						? {
								type,
								title,
								stem: "Explain.",
								tags: [...tags],
								content: "text",
							}
						: {
								type,
								title,
								stem: "Which one?",
								tags: [...tags],
								choices: [
									{ id: "right", text: "This one", score: 1 },
									{ id: "wrong", text: "That one" },
								],
							},
			},
			opts,
		);
		const updatedAt = UPDATED[index] as Date;
		await prisma.questionRef.update({
			where: { id: created.id },
			data: { updatedAt },
		});
		rows.push({
			id: created.id,
			slug,
			status,
			type: type.replace(/-/g, "_").toUpperCase(),
			title,
			updated: updatedAt.getTime(),
		});
	}
	return { course, rows };
}

/// The slugs of `rows` ordered by `sort`, ties broken by id in the same direction.
function ordered(rows: Row[], sort: QuestionSort): string[] {
	const sign = sort.direction === "asc" ? 1 : -1;
	const compare = (a: string | number, b: string | number) =>
		a < b ? -1 : a > b ? 1 : 0;
	return [...rows]
		.sort(
			(a, b) =>
				sign * (compare(a[sort.field], b[sort.field]) || compare(a.id, b.id)),
		)
		.map((row) => row.slug);
}

/// The slugs of every page of two rows, walked forward to the end and then back to the start.
async function walk(
	filter: Omit<QuestionPageFilter, "limit" | "after" | "before">,
): Promise<{ forward: string[][]; backward: string[][] }> {
	const slugs = (page: Page<Question>) => page.items.map((item) => item.slug);
	const read = (cursor: { after?: string; before?: string }) =>
		db.question.findPage(
			{ ...filter, public: false, limit: 2, ...cursor },
			opts,
		);

	let page = await read({});
	expect(page.prev).toBeNull();
	const forward = [slugs(page)];
	while (page.next !== null) {
		page = await read({ after: page.next });
		forward.push(slugs(page));
	}
	const backward = [slugs(page)];
	while (page.prev !== null) {
		page = await read({ before: page.prev });
		backward.unshift(slugs(page));
	}
	expect(page.next === null).toBe(forward.length === 1);
	return { forward, backward };
}

/// `slugs` cut in pages of two.
function inPairs(slugs: string[]): string[][] {
	const pages: string[][] = [];
	for (let i = 0; i < slugs.length; i += 2) pages.push(slugs.slice(i, i + 2));
	return pages;
}

test.describe("pair cursor", () => {
	test("a cursor reads back as the key it was made from, in its own order only", () => {
		for (const key of [
			{ value: "DRAFT", id: 12 },
			{ value: 'Título com acento, vírgula e "aspas"', id: 1 },
			{ value: 1767225600000, id: 2 ** 40 },
		]) {
			const cursor = encodeKeyCursor("status:asc", key);
			expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
			expect(decodeKeyCursor(cursor, "status:asc")).toEqual(key);
			expect(() => decodeKeyCursor(cursor, "status:desc")).toThrow(InvalidData);
		}
	});

	test("text that is not a pair cursor is refused as invalid data", () => {
		const base64 = (value: unknown) =>
			Buffer.from(JSON.stringify(value)).toString("base64url");
		for (const text of [
			"",
			"not a cursor",
			encodeCursor(7),
			base64(["slug:asc", "a"]),
			base64(["slug:asc", null, encodeCursor(1)]),
			base64(["slug:asc", "a", 1]),
			base64(["slug:asc", "a", "NOT-AN-ID"]),
			base64({ order: "slug:asc" }),
		])
			expect(() => decodeKeyCursor(text, "slug:asc"), text).toThrow(
				InvalidData,
			);
	});

	test("the rows past a key repeat its value only with an id further on", () => {
		const column = (status: unknown) => ({ status });
		expect(pairWhere("DRAFT", 4, "asc", column)).toEqual({
			OR: [
				{ status: { gt: "DRAFT" } },
				{ AND: [{ status: { equals: "DRAFT" } }, { id: { gt: 4 } }] },
			],
		});
		expect(pairWhere("DRAFT", 4, "desc", column)).toEqual({
			OR: [
				{ status: { lt: "DRAFT" } },
				{ AND: [{ status: { equals: "DRAFT" } }, { id: { lt: 4 } }] },
			],
		});
	});

	test("a page read backwards scans the list in the opposite direction", () => {
		const seek = { limit: 2, cursor: "x" };
		expect(scanDirection("asc", { ...seek, back: false })).toBe("asc");
		expect(scanDirection("asc", { ...seek, back: true })).toBe("desc");
		expect(scanDirection("desc", { ...seek, back: true })).toBe("asc");
	});
});

test.describe("pages of questions", () => {
	let course: CourseId;
	let rows: Row[];

	test.beforeAll(async () => {
		({ course, rows } = await makeBank());
	});

	for (const field of ["slug", "title", "status", "type", "updated"] as const)
		for (const direction of ["asc", "desc"] as const)
			test(`ordered by ${field} ${direction}, the pages cover every question once, both ways`, async () => {
				const sort = { field, direction };
				const expected = inPairs(ordered(rows, sort));
				expect(expected).toHaveLength(4);

				const { forward, backward } = await walk({ course, sort });
				expect(forward).toEqual(expected);
				expect(backward).toEqual(expected);
			});

	test("with no order named, the pages come by slug", async () => {
		const { forward } = await walk({ course });
		expect(forward.flat()).toEqual(BANK.map(([slug]) => slug));
	});

	test("filters narrow the pages and the count alike", async () => {
		const cases = [
			{ statuses: ["DRAFT" as const] },
			{ types: ["essay" as const] },
			{ tags: ["arrays", "trees"] },
			{
				statuses: ["DRAFT" as const, "PUBLISHED" as const],
				types: ["essay" as const],
			},
			{ statuses: ["HIDDEN" as const], tags: ["trees"] },
		];
		for (const filter of cases) {
			const matching = rows.filter((row, index) => {
				const [, status, type, , tags] = BANK[index] ?? BANK[0];
				return (
					(!filter.statuses ||
						(filter.statuses as string[]).includes(status)) &&
					(!filter.types || (filter.types as string[]).includes(type)) &&
					(!filter.tags || tags.some((tag) => filter.tags?.includes(tag))) &&
					row !== undefined
				);
			});
			const sort = { field: "status", direction: "desc" } as const;
			const { forward, backward } = await walk({ course, sort, ...filter });
			expect(forward.flat(), JSON.stringify(filter)).toEqual(
				ordered(matching, sort),
			);
			expect(backward).toEqual(forward);
			expect(await db.question.count({ course, ...filter }, opts)).toBe(
				matching.length,
			);
		}
		expect(await db.question.count({ course }, opts)).toBe(BANK.length);
	});

	test("a cursor of one order is refused by another", async () => {
		const status = { field: "status", direction: "asc" } as const;
		const first = await db.question.findPage(
			{ course, limit: 2, sort: status },
			opts,
		);
		const cursor = first.next as string;
		expect(cursor).not.toBeNull();

		for (const sort of [
			{ field: "status", direction: "desc" },
			{ field: "type", direction: "asc" },
			{ field: "updated", direction: "asc" },
			undefined,
		] as const) {
			for (const param of ["after", "before"] as const) {
				const refused = db.question.findPage(
					{ course, limit: 2, sort, [param]: cursor },
					opts,
				);
				await expect(refused).rejects.toThrow(InvalidData);
				await expect(refused).rejects.toMatchObject({
					errors: { [param]: expect.anything() },
				});
			}
		}
		await expect(
			db.question.findPage({ course, after: "not a cursor" }, opts),
		).rejects.toThrow(InvalidData);
		// A cursor whose value is not of the kind the column holds.
		await expect(
			db.question.findPage(
				{
					course,
					sort: { field: "updated", direction: "asc" },
					after: encodeKeyCursor("updated:asc", { value: "soon", id: 1 }),
				},
				opts,
			),
		).rejects.toThrow(InvalidData);
		await expect(
			db.question.findPage(
				{ course, after: first.next as string, before: cursor, sort: status },
				opts,
			),
		).rejects.toThrow(InvalidData);
	});

	test("the tags of the bank are listed once each, whatever the other filters", async () => {
		const expected = ["arrays", "graphs", "queues", "trees"];
		expect(await db.question.tags({ course }, opts)).toEqual(expected);
		expect(
			await db.question.tags({ course, statuses: ["ARCHIVED"] }, opts),
		).toEqual(expected);
	});

	test("a student pages, counts and reads the tags of the published questions only", async () => {
		const student = await persistedUserFactory.create({ role: "STUDENT" });
		await db.enrollment.create({ course, username: student.username }, opts);
		const actor = { actor: student };

		const page = await db.question.findPage(
			{ course, sort: { field: "title", direction: "asc" } },
			actor,
		);
		expect(page.items.map((item) => item.slug)).toEqual(["q-02", "q-06"]);
		expect(JSON.stringify(page.items[0]?.question)).not.toContain("score");
		expect(await db.question.count({ course }, actor)).toBe(2);
		expect(await db.question.tags({ course }, actor)).toEqual([
			"arrays",
			"trees",
		]);
		await expect(
			db.question.findPage({ course, public: false }, actor),
		).rejects.toThrow();
	});
});
