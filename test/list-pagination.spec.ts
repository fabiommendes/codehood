import { expect, test } from "@playwright/test";
import { SYSTEM } from "@/auth/actor";
import { InvalidData } from "@/core/error";
import type { Page, PageParams } from "@/core/schemas/page";
import { db, isEditionOpen } from "@/db";
import { persistedDisciplineFactory } from "@/fixtures/discipline.factory";
import { persistedEditionFactory } from "@/fixtures/edition.factory";
import { cutPage, decodeCursor, encodeCursor, seekOf } from "@/utils/cursor";
import { actionHref, listUrl, pageLimit, readPage } from "@/utils/list-page";
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

	test("walking back from the last page of each paginated list returns every page in order", async () => {
		await persistedDisciplineFactory.createList(2);
		await persistedEditionFactory.createList(2);
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
			{
				page: (params: PageParams) => db.discipline.findPage(params, opts),
				key: (item: unknown) => (item as { slug: string }).slug,
			},
			{
				page: (params: PageParams) => db.edition.findPage(params, opts),
				key: (item: unknown) => (item as { slug: string }).slug,
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

	test("the pages of disciplines cover every discipline once, by slug", async () => {
		await persistedDisciplineFactory.createList(3);
		const all = await db.discipline.findMany({}, opts);
		const slugs = all.map((discipline) => discipline.slug).sort();

		for (const limit of [1, 2, all.length, all.length + 1]) {
			const { items, pages } = await walk((after) =>
				db.discipline.findPage({ limit, after }, opts),
			);
			expect(items.map((discipline) => discipline.slug)).toEqual(slugs);
			expect(pages).toBe(Math.max(1, Math.ceil(all.length / limit)));
		}
		expect(await db.discipline.count({}, opts)).toBe(all.length);
	});

	test("the pages of editions cover every edition once, the latest slug first", async () => {
		await persistedEditionFactory.createList(3);
		const all = await db.edition.findMany({}, opts);
		const slugs = all.map((edition) => edition.slug);
		expect(slugs).toEqual([...slugs].sort().reverse());

		for (const limit of [1, 2, all.length + 1]) {
			const { items, pages } = await walk((after) =>
				db.edition.findPage({ limit, after }, opts),
			);
			expect(items.map((edition) => edition.slug)).toEqual(slugs);
			expect(pages).toBe(Math.max(1, Math.ceil(all.length / limit)));
		}
		expect(await db.edition.count({}, opts)).toBe(all.length);
	});

	test("a page of disciplines or editions keeps the filter and the count agrees with it", async () => {
		const disciplines = await persistedDisciplineFactory.createList(3);
		const slugs = disciplines.map((discipline) => discipline.slug);
		const some = await walk((after) =>
			db.discipline.findPage({ slugs, limit: 2, after }, opts),
		);
		expect(some.items.map((discipline) => discipline.slug)).toEqual(
			[...slugs].sort(),
		);
		expect(await db.discipline.count({ slugs }, opts)).toBe(3);

		const open = (await db.edition.findMany({}, opts)).filter((edition) =>
			isEditionOpen(edition),
		);
		expect(open.length).toBeGreaterThan(0);
		const active = await walk((after) =>
			db.edition.findPage({ active: true, limit: 1, after }, opts),
		);
		expect(active.items.map((edition) => edition.slug)).toEqual(
			open.map((edition) => edition.slug),
		);
		expect(await db.edition.count({ active: true }, opts)).toBe(open.length);
	});

	test("a student pages over the same disciplines and editions as an admin", async () => {
		const student = {
			username: "nobody-enrolled",
			name: "Nobody",
			role: "STUDENT" as const,
		};
		const actor = { actor: student as never };
		for (const list of [db.discipline, db.edition]) {
			const mine = await list.findPage({ limit: 500 }, actor);
			const everything = await list.findPage({ limit: 500 }, opts);
			expect(mine).toEqual(everything);
			expect(await list.count({}, actor)).toBe(await list.count({}, opts));
		}
	});
});

test.describe("list pages", () => {
	test("the page size of a list page comes from its URL, within bounds", () => {
		const limit = (query: string) =>
			pageLimit(new URL(`http://x/list${query}`));
		expect(limit("")).toBe(50);
		expect(limit("?limit=2")).toBe(2);
		expect(limit("?limit=0")).toBe(1);
		expect(limit("?limit=9999")).toBe(500);
		for (const bad of ["?limit=", "?limit=-3", "?limit=2.5", "?limit=many"])
			expect(limit(bad)).toBe(50);
	});

	test("a form posts back to the place in the list it was shown at", () => {
		const posted = new URL(
			"http://x/admin/users?_action=admin.createUser&after=bob&limit=2",
		);
		const here = listUrl(posted);
		expect(here.search).toBe("?after=bob&limit=2");
		expect(posted.searchParams.has("_action")).toBe(true);
		expect(actionHref("?_action=admin.forceLogout", here.search)).toBe(
			"?_action=admin.forceLogout&after=bob&limit=2",
		);
		expect(actionHref("?_action=admin.forceLogout", "")).toBe(
			"?_action=admin.forceLogout",
		);
		expect(pageLinks(here, { next: "carol", prev: null }).nextHref).toBe(
			"/admin/users?limit=2&after=carol",
		);
	});

	test("a cursor past the last row, or that is not one, reads the first page", async () => {
		const first = await db.user.findPage({ limit: 2 }, opts);
		const find = (params: PageParams) => db.user.findPage(params, opts);

		const stranded = await readPage(
			new URL("http://x/admin/users?limit=2&after=~~~~"),
			find,
		);
		expect(stranded).toEqual(first);

		const courses = (params: PageParams) => db.course.findPage(params, opts);
		expect(
			await readPage(new URL("http://x/courses?limit=1&before=NOPE"), courses),
		).toEqual(await db.course.findPage({ limit: 1 }, opts));

		const second = await readPage(
			new URL(`http://x/admin/users?limit=2&after=${first.next}`),
			find,
		);
		expect(second.prev).not.toBeNull();
		expect(second.items[0]?.username).not.toBe(first.items[0]?.username);
	});
});
