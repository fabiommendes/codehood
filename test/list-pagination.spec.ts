import { expect, test } from "@playwright/test";
import { SYSTEM } from "@/auth/actor";
import { InvalidData } from "@/core/error";
import type { Page, PageParams } from "@/core/schemas";
import { db } from "@/db";
import { cutPage, decodeCursor, encodeCursor, seekOf } from "@/utils/cursor";
import { cursorParams, pageLinks } from "@/utils/page-links";

const opts = { actor: SYSTEM } as const;

/// Reads a whole list, `limit` rows at a time.
async function walk<Item>(
	page: (after: string | undefined) => Promise<Page<Item>>,
): Promise<{ items: Item[]; pages: number }> {
	const items: Item[] = [];
	let after: string | undefined;
	for (let pages = 1; ; pages++) {
		const { items: some, next } = await page(after);
		items.push(...some);
		if (next === null) return { items, pages };
		after = next;
	}
}

test.describe("cursor", () => {
	test("a cursor reads back as the id it was made from", () => {
		for (const id of [0, 1, 2, 41, 1_000_003, Number.MAX_SAFE_INTEGER])
			expect(decodeCursor(encodeCursor(id))).toBe(id);
	});

	test("neighbouring ids make cursors that do not look alike", () => {
		const cursors = [1, 2, 3].map(encodeCursor);
		expect(new Set(cursors).size).toBe(3);
		for (const cursor of cursors) expect(cursor).toMatch(/^[0-9a-z]{8,13}$/);
	});

	test("text that is not a cursor is refused as invalid data", () => {
		for (const text of ["", "NOT-A-CURSOR", "1; DROP", "z".repeat(14), "0"])
			expect(() => decodeCursor(text)).toThrow(InvalidData);
	});

	test("a forward read cuts the extra row off and points past the last one kept", () => {
		const first = { limit: 2, back: false, cursor: undefined };
		expect(cutPage([1, 2, 3], first, String)).toEqual({
			page: [1, 2],
			next: "2",
			prev: null,
		});
		expect(cutPage([1, 2], first, String)).toEqual({
			page: [1, 2],
			next: null,
			prev: null,
		});
		expect(cutPage([], first, String)).toEqual({
			page: [],
			next: null,
			prev: null,
		});
		expect(cutPage([3, 4], { ...first, cursor: "2" }, String)).toEqual({
			page: [3, 4],
			next: null,
			prev: "3",
		});
	});

	test("a backward read comes back in list order, with a next to return by", () => {
		const back = { limit: 2, back: true, cursor: "5" };
		expect(cutPage([4, 3, 2], back, String)).toEqual({
			page: [3, 4],
			next: "4",
			prev: "3",
		});
		expect(cutPage([2, 1], back, String)).toEqual({
			page: [1, 2],
			next: "2",
			prev: null,
		});
	});

	test("asking for both directions at once is refused", () => {
		expect(() => seekOf({ after: "a", before: "b" })).toThrow(InvalidData);
		expect(seekOf({})).toEqual({ limit: 100, back: false, cursor: undefined });
		expect(seekOf({ before: "b", limit: 3 })).toEqual({
			limit: 3,
			back: true,
			cursor: "b",
		});
	});

	test("the links of a pager keep the filters and swap the cursor", () => {
		const url = new URL("http://x/admin/users?role=ADMIN&after=old");
		expect(pageLinks(url, { next: "n", prev: "p" })).toEqual({
			nextHref: "/admin/users?role=ADMIN&after=n",
			prevHref: "/admin/users?role=ADMIN&before=p",
		});
		expect(pageLinks(url, { next: null, prev: null })).toEqual({
			nextHref: undefined,
			prevHref: undefined,
		});
		expect(cursorParams(url)).toEqual({ after: "old" });
		expect(cursorParams(new URL("http://x/?before=b&after=a"))).toEqual({
			before: "b",
		});
		expect(cursorParams(new URL("http://x/"))).toEqual({ after: undefined });
	});
});

test.describe("paginated lists", () => {
	test("the pages of courses cover every course once, whatever the page size", async () => {
		const all = await db.course.findMany({}, opts);
		expect(all.length).toBeGreaterThan(1);
		const ids = all.map((course) => course.id).sort((a, b) => a - b);

		for (const limit of [1, 2, all.length, all.length + 1]) {
			const { items, pages } = await walk((after) =>
				db.course.findPage({ limit, after }, opts),
			);
			expect(items.map((course) => course.id)).toEqual(ids);
			expect(pages).toBe(Math.max(1, Math.ceil(all.length / limit)));
		}
	});

	test("a page of courses keeps the filter and the count agrees with it", async () => {
		const [first] = await db.course.findMany({}, opts);
		const filter = { instructor: first?.instructor.username };
		const expected = await db.course.findMany(filter, opts);

		const { items } = await walk((after) =>
			db.course.findPage({ ...filter, limit: 1, after }, opts),
		);
		expect(items).toHaveLength(expected.length);
		expect(await db.course.count(filter, opts)).toBe(expected.length);
		expect(await db.course.count({}, opts)).toBe(
			(await db.course.findMany({}, opts)).length,
		);
	});

	test("walking back from the last page of courses and of users returns every page in order", async () => {
		const lists: {
			page: (params: PageParams) => Promise<Page<unknown>>;
			key: (item: unknown) => unknown;
		}[] = [
			{
				page: (params: PageParams) => db.course.findPage(params, opts),
				key: (item: unknown) => (item as { id: number }).id,
			},
			{
				page: (params: PageParams) => db.user.findPage(params, opts),
				key: (item: unknown) => (item as { username: string }).username,
			},
		];
		for (const { page, key } of lists) {
			const forward: unknown[][] = [];
			let current = await page({ limit: 2 });
			expect(current.prev).toBeNull();
			forward.push(current.items.map(key));
			while (current.next !== null) {
				current = await page({ limit: 2, after: current.next });
				forward.push(current.items.map(key));
			}
			expect(forward.length).toBeGreaterThan(1);

			const backward = [current.items.map(key)];
			while (current.prev !== null) {
				current = await page({ limit: 2, before: current.prev });
				backward.unshift(current.items.map(key));
			}
			expect(backward).toEqual(forward);
		}
	});

	test("a course cursor that is not one is refused", async () => {
		await expect(
			db.course.findPage({ after: "not a cursor" }, opts),
		).rejects.toThrow(InvalidData);
	});

	test("the pages of users cover every user once, by username", async () => {
		const all = await db.user.findMany({}, opts);
		const usernames = all.map((user) => user.username).sort();

		const { items, pages } = await walk((after) =>
			db.user.findPage({ limit: 2, after }, opts),
		);
		expect(items.map((user) => user.username)).toEqual(usernames);
		expect(pages).toBe(Math.ceil(all.length / 2));
		expect(await db.user.count({}, opts)).toBe(all.length);
	});

	test("a user who is not an admin pages over themself alone", async () => {
		const [someone] = await db.user.findMany({}, opts);
		const actor = { ...someone, role: "STUDENT" as const };
		const page = await db.user.findPage({}, { actor: actor as never });
		expect(page.items.map((user) => user.username)).toEqual([
			someone?.username,
		]);
		expect(page.next).toBeNull();
	});

	test("users counted by role add up to the users listed", async () => {
		const all = await db.user.findMany({}, opts);
		const counts = await db.user.countByRole(opts);
		for (const role of ["ADMIN", "INSTRUCTOR", "STUDENT"] as const)
			expect(counts[role]).toBe(
				all.filter((user) => user.role === role).length,
			);
	});

	test("courses counted by discipline and by edition agree with the courses listed", async () => {
		const all = await db.course.findMany({}, opts);
		const tally = (key: (course: (typeof all)[number]) => string) => {
			const counts = new Map<string, number>();
			for (const course of all)
				counts.set(key(course), (counts.get(key(course)) ?? 0) + 1);
			return counts;
		};
		expect(await db.course.countBy("discipline", opts)).toEqual(
			tally((course) => course.discipline.slug),
		);
		expect(await db.course.countBy("edition", opts)).toEqual(
			tally((course) => course.edition.slug),
		);
	});

	test("a student counts only the courses they take part in", async () => {
		const [course] = await db.course.findMany({}, opts);
		const outsider = {
			username: "nobody-enrolled",
			name: "Nobody",
			role: "STUDENT" as const,
		};
		expect(course).toBeDefined();
		expect(
			(await db.course.countBy("discipline", { actor: outsider as never }))
				.size,
		).toBe(0);
	});
});
