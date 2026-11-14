import { APIS } from "@/api/registry/hook";
import { buildOpenApiDocument } from "@/api/registry/openapi-document";
import { isoDate } from "@/core/schemas";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedDisciplineFactory } from "@/fixtures/discipline.factory";
import { persistedEditionFactory } from "@/fixtures/edition.factory";
import { collectSearchParams } from "@/utils/query-coerce";
import { expect, test } from "./fixtures";
import { seedUser } from "./stories/helpers";

/**
 * HTTP-level tests for the generated CRUD REST API's GET endpoints.
 *
 * Bug (a) — every CRUD GET used to return 400 — is now FIXED: `route()`
 * (src/api/registry/index.ts) reads a GET/DELETE's input from
 * `new URL(request.url).searchParams` instead of trying `await
 * request.json()` on a request that never has a body. Query strings only
 * ever carry strings, so `src/utils/query-coerce.ts` coerces each field to
 * the type its Zod schema actually wants (number/boolean/date) before
 * validation runs — the exact same `options.in.safeParse(...)` a JSON body
 * goes through. The 9 tests below that used to document this bug via
 * `test.fail` are now plain, passing tests; the coercion/filtering behavior
 * itself is proven by the tests further d/own.
 *
 * `CRUD()`'s `findOne`/`update`/`delete` also used to read their primary
 * key from the wrong place (`findOne` from the body — which the query-string
 * fix would have "fixed" into pulling from the query string, still wrong,
 * since the id lives in the URL *path*). They now read `params` (the path
 * segment) and validate it against `filterPk` before it reaches a service,
 * exactly like a query filter does.
 *
 * Bug (b) — GET /api/calendar 404s — is a different root cause and is NOT
 * fixed here. src/api/index.ts:28 registers the CRUD resource at path
 * "/api/calendar", but src/api/registry/hook.ts:6 lists the injected-route
 * resource name as "calendar-event", so Astro's dynamic router only ever
 * wires up "/api/calendar-event". The ROUTES map in
 * src/api/registry/index.ts is keyed "/api/calendar", so nothing serves
 * that path and Astro falls through to its own 404 page. That test stays a
 * `test.fail`.
 */

// Resources whose `filter` schema is all-optional, so a bare GET with no
// query string is a valid "give me everything" request.
const OPTIONAL_FILTER_RESOURCES = [
	"course",
	"discipline",
	"edition",
	"user",
] as const;

/// Logs in a fresh admin, so the spec depends on no account of the seed.
async function adminToken(
	request: import("@playwright/test").APIRequestContext,
) {
	const admin = await seedUser({ role: "ADMIN" });
	const login = await request.post("/api/auth/login", {
		data: { login: admin.username, password: admin.password },
	});
	expect(login.ok()).toBe(true);
	const { token } = await login.json();
	return token as string;
}

/// A course with its own discipline, edition and instructor, created once per file.
let world: Awaited<ReturnType<typeof persistedCourseFactory.create>>;

test.beforeAll(async () => {
	world = await persistedCourseFactory.create();
});

/// The `<discipline>/<instructor>_<edition>` path segments of `world`.
function worldPath(): string {
	return `${world.discipline.slug}/${world.instructor.username}_${world.edition.slug}`;
}

function authHeader(token: string) {
	return { Authorization: `Bearer ${token}`, Cookie: "" };
}

for (const resource of OPTIONAL_FILTER_RESOURCES) {
	test(`GET /api/${resource} returns 200 with a page of items`, async ({
		request,
	}) => {
		const token = await adminToken(request);
		const res = await request.get(`/api/${resource}`, {
			headers: authHeader(token),
		});
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(Object.keys(body).sort()).toEqual(["items", "next", "prev"]);
		expect(Array.isArray(body.items)).toBe(true);
	});
}

// Unlike the resources above, `apiKeyFilter` requires `createdBy` — there is
// no "list every API key" endpoint by design — so a bare `GET /api/api-key`
// legitimately 400s even after the fix. This is not bug (a): it's the
// filter schema doing its job. Supply the required filter instead.
//
// `createdBy` (a username), not `createdById`: `dev/specs/to-do/api-no-raw-ids.md`
// renames it because the value it carries is a username, not a raw id.
test("GET /api/api-key?createdBy=<username> returns 200 with a page of items", async ({
	request,
}) => {
	const token = await adminToken(request);
	const instructor = await seedUser({ role: "INSTRUCTOR" });
	const owner = await request.get(
		`/api/user?usernames=${instructor.username}`,
		{ headers: authHeader(token) },
	);
	expect(owner.status()).toBe(200);
	const [ownerUser] = (await owner.json()).items;
	expect(ownerUser.username).toBe(instructor.username);

	const res = await request.get(
		`/api/api-key?createdBy=${ownerUser.username}`,
		{
			headers: authHeader(token),
		},
	);
	expect(res.status()).toBe(200);
	const body = await res.json();
	expect(Array.isArray(body.items)).toBe(true);
	expect(body.next).toBeNull();
});

// A course is addressed by its natural key, the same `<discipline>/<username>_<edition>`
// the web app uses, and no longer by its autoincrement id. The three status
// codes below are the substance of that change: a segment that doesn't match
// the grammar is a client bug (400), one that does but names nothing is a miss
// (404), and a course you may not see is a refusal (403). The web app rounds
// the first down to 404 on purpose; the API does not. See
// src/urls/README.md.
test("GET /api/course/[discipline]/[course] resolves a course by its natural key", async ({
	request,
}) => {
	const token = await adminToken(request);
	const list = await request.get("/api/course", { headers: authHeader(token) });
	expect(list.status()).toBe(200);
	const [course] = (await list.json()).items;
	expect(course).toBeTruthy();

	const res = await request.get(
		`/api/course/${course.discipline.slug}/${course.instructor.username}_${course.edition.slug}`,
		{ headers: authHeader(token) },
	);
	expect(res.status()).toBe(200);
	const body = await res.json();
	expect(Array.isArray(body)).toBe(false);
	expect(body.discipline.slug).toBe(course.discipline.slug);
	expect(body.instructor.username).toBe(course.instructor.username);
	expect(body.edition.slug).toBe(course.edition.slug);
});

test("GET /api/course/[id] is gone", async ({ request }) => {
	const token = await adminToken(request);
	const res = await request.get("/api/course/1", {
		headers: authHeader(token),
	});
	expect(res.status()).toBe(404);
});

test("a malformed course segment is a 400, not a 404", async ({ request }) => {
	const token = await adminToken(request);
	const res = await request.get("/api/course/cs101/no-underscore-here", {
		headers: authHeader(token),
	});
	expect(res.status()).toBe(400);
	expect((await res.json()).code).toBe("invalid-data");
});

test("a well-formed course segment naming no course is a 404", async ({
	request,
}) => {
	const token = await adminToken(request);
	const res = await request.get("/api/course/cs101/nobody_2099-1", {
		headers: authHeader(token),
	});
	expect(res.status()).toBe(404);
	expect((await res.json()).code).toBe("not-found");
});

// A resource addressed by a single segment carrying something other than `id`
// still routes through the literal `[id]` segment `CRUD` injects by default;
// `options.pk` renames the field, not the segment. (A natural key spanning
// several segments sets `pkPath` instead — see the course tests above.)
// Getting this wrong 404s (segment renamed to `[slug]`, so nothing serves it)
// or 400s (`slug: expected string, received undefined`), which is exactly what
// these two used to do.
for (const [resource, pkField] of [
	["discipline", "slug"],
	["edition", "slug"],
] as const) {
	test(`GET /api/${resource}/[${pkField}] resolves a ${resource} by its ${pkField}`, async ({
		request,
	}) => {
		const token = await adminToken(request);
		const list = await request.get(`/api/${resource}`, {
			headers: authHeader(token),
		});
		expect(list.status()).toBe(200);
		const [first] = (await list.json()).items;
		expect(first).toBeTruthy();

		const res = await request.get(
			`/api/${resource}/${encodeURIComponent(first[pkField])}`,
			{ headers: authHeader(token) },
		);
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(Array.isArray(body)).toBe(false);
		expect(body[pkField]).toBe(first[pkField]);
	});
}

// JSON has no date type: a course date travels as a `YYYY-MM-DD` string and
// comes back as the same string.
test("POST /api/course accepts ISO dates for startDate/endDate", async ({
	request,
}) => {
	const token = await adminToken(request);
	const discipline = await persistedDisciplineFactory.create();
	const edition = await persistedEditionFactory.create();
	const instructor = await seedUser({ role: "INSTRUCTOR" });

	const startDate = "2031-01-06";
	const endDate = "2031-06-30";
	const res = await request.post("/api/course", {
		headers: authHeader(token),
		data: {
			discipline: discipline.slug,
			instructor: instructor.username,
			edition: edition.slug,
			description: "created by api-crud.spec",
			startDate,
			endDate,
		},
	});
	expect(res.status()).toBe(200);
	const body = await res.json();
	expect(body.startDate).toBe(startDate);
	expect(body.endDate).toBe(endDate);
});

// Calendar events live under their course: the listing has no "every course"
// form over the API, so the course segments are the whole filter here.
test("GET /api/course/<discipline>/<course>/calendar-event returns 200 with a page of items", async ({
	request,
}) => {
	const token = await adminToken(request);
	const res = await request.get(`/api/course/${worldPath()}/calendar-event`, {
		headers: authHeader(token),
	});
	expect(res.status()).toBe(200);
	const body = await res.json();
	expect(Array.isArray(body.items)).toBe(true);
	expect(body.next).toBeNull();
});

// The guard that would have caught bug (b) — and the `[slug]` segment mismatch
// — the moment either was introduced. `hook.ts` hardcodes the patterns it
// injects into Astro, because it cannot import the route modules to discover
// them; `CRUD()`/`route()` register their own paths independently. When the two
// drift, Astro serves a pattern `ROUTES` has no entry for and the endpoint 404s
// with an HTML page, which no other test would notice.
test("every registered API path is a pattern hook.ts actually injects into Astro", () => {
	const registered = Object.keys(buildOpenApiDocument().paths ?? {});
	expect(registered.length).toBeGreaterThan(0);

	// The document spells a dynamic segment `{id}` and `hook.ts` spells it
	// `[id]`, so compare in Astro's spelling — the one Astro is actually
	// handed.
	const injected = new Set(APIS);
	const orphaned = registered
		.map((path) => path.replace(/\{([^}]+)\}/g, "[$1]"))
		.filter((path) => !injected.has(path));
	expect(orphaned).toEqual([]);
});

test("a query filter that matches narrows the list to only the matching row", async ({
	request,
}) => {
	const token = await adminToken(request);
	const suffix = Date.now().toString().slice(-8);
	const slugA = `qa-crud-a${suffix}`;
	const slugB = `qa-crud-b${suffix}`;
	for (const slug of [slugA, slugB]) {
		const created = await request.post("/api/discipline", {
			headers: authHeader(token),
			data: { slug, name: `QA ${slug}` },
		});
		expect(created.ok()).toBe(true);
	}

	const res = await request.get(`/api/discipline?slugs=${slugA}`, {
		headers: authHeader(token),
	});
	expect(res.status()).toBe(200);
	const body = await res.json();
	expect(body.items.map((d: { slug: string }) => d.slug)).toEqual([slugA]);
	expect(body.next).toBeNull();
});

test("a query filter that matches nothing returns an empty page, not everything", async ({
	request,
}) => {
	const token = await adminToken(request);
	const res = await request.get(
		"/api/discipline?slugs=qa-crud-does-not-exist",
		{
			headers: authHeader(token),
		},
	);
	expect(res.status()).toBe(200);
	expect(await res.json()).toEqual({ items: [], next: null, prev: null });
});

test("?active=false is honored as false, not truthy — a naive Boolean('false') would wrongly read it as true", async ({
	request,
}) => {
	const token = await adminToken(request);
	// An edition whose window is fixed safely in the past, so it always reads as
	// inactive.
	const { slug } = await persistedEditionFactory.create({
		startDate: isoDate.parse("2001-01-08"),
		endDate: isoDate.parse("2001-06-30"),
	});

	// The edition's window is entirely in the past, so it is not "active"
	// right now. `active=true` must exclude it...
	const activeOnly = await request.get(
		`/api/edition?slugs=${slug}&active=true`,
		{ headers: authHeader(token) },
	);
	expect(activeOnly.status()).toBe(200);
	expect(await activeOnly.json()).toEqual({
		items: [],
		next: null,
		prev: null,
	});

	// ...while `active=false` must NOT be coerced into the boolean `true`
	// (which is what `Boolean("false")` — the classic bug — would do): the
	// service only adds the "currently active" constraint when `active` is
	// truthy, so a correctly-parsed `false` here still returns the edition.
	const inactiveAllowed = await request.get(
		`/api/edition?slugs=${slug}&active=false`,
		{ headers: authHeader(token) },
	);
	expect(inactiveAllowed.status()).toBe(200);
	const body = await inactiveAllowed.json();
	expect(body.items.map((e: { slug: string }) => e.slug)).toEqual([slug]);
	expect(body.next).toBeNull();
});

test("a value needing escaping (space, &, #, and a quote) round-trips exactly through the query string", async ({
	request,
}) => {
	const weird = "has space & a # and a 'quote";
	const qs = new URLSearchParams({ slugs: weird }).toString();

	// Proves the exact mechanism `route()` uses to read a query string decodes
	// the percent-escaped value back to the exact string we built it from —
	// not truncated at "&"/"#", the characters that break a hand-rolled parser.
	const seen = collectSearchParams(new URL(`http://x/?${qs}`).searchParams);
	expect(seen.slugs).toBe(weird);

	// And end-to-end: the server accepts it (200, never a crash) and, since no
	// discipline slug is ever this string, matches nothing.
	const token = await adminToken(request);
	const res = await request.get(`/api/discipline?${qs}`, {
		headers: authHeader(token),
	});
	expect(res.status()).toBe(200);
	expect(await res.json()).toEqual({ items: [], next: null, prev: null });
});

test("an injection-shaped filter value returns an empty result, never the whole table", async ({
	request,
}) => {
	const token = await adminToken(request);
	// Sanity check: the table is not already empty, so an empty result below
	// actually proves the filter worked rather than there being nothing to find.
	const everything = await request.get("/api/discipline", {
		headers: authHeader(token),
	});
	expect((await everything.json()).items.length).toBeGreaterThan(0);

	const qs = new URLSearchParams({ slugs: "' OR 1=1--" }).toString();
	const res = await request.get(`/api/discipline?${qs}`, {
		headers: authHeader(token),
	});
	// Prisma parameterizes the query either way, so this can only ever be a
	// literal (non-matching) string comparison — never a 500, and never the
	// full table.
	expect(res.status()).toBe(200);
	expect(await res.json()).toEqual({ items: [], next: null, prev: null });
});

for (const key of [
	"__proto__[x]",
	"constructor[prototype][x]",
	"slugs[__proto__][x]",
]) {
	test(`a prototype-shaped query key (${key}) is never a 500`, async ({
		request,
	}) => {
		const token = await adminToken(request);
		const res = await request.get(
			`/api/discipline?${encodeURIComponent(key)}=1`,
			{ headers: authHeader(token) },
		);
		expect(res.status()).toBeLessThan(500);
		expect(({} as Record<string, unknown>).x).toBeUndefined();
	});
}

test("POST /api/course refuses a course date that carries a time", async ({
	request,
}) => {
	const token = await adminToken(request);
	const discipline = await persistedDisciplineFactory.create();
	const edition = await persistedEditionFactory.create();
	const instructor = await seedUser({ role: "INSTRUCTOR" });

	const res = await request.post("/api/course", {
		headers: authHeader(token),
		data: {
			discipline: discipline.slug,
			instructor: instructor.username,
			edition: edition.slug,
			startDate: "2031-01-06T00:00:00.000Z",
			endDate: "2031-06-30",
		},
	});
	expect(res.status()).toBe(400);
});

/// One page of a list route, as the REST API answers it.
type ListPage<Item> = { items: Item[]; next: string | null };

type CourseItem = {
	discipline: { slug: string };
	instructor: { username: string };
	edition: { slug: string };
};

/// The natural key of a course of a list, which names it apart from every other.
function courseKey(course: CourseItem): string {
	return `${course.discipline.slug}/${course.instructor.username}_${course.edition.slug}`;
}

/// Reads a whole list by following `next` from the first page to the last.
async function walkList<Item>(
	request: import("@playwright/test").APIRequestContext,
	token: string,
	path: string,
	limit: number,
): Promise<{ items: Item[]; pages: number }> {
	const items: Item[] = [];
	let after: string | null = null;
	for (let pages = 1; ; pages++) {
		const query = new URLSearchParams({ limit: String(limit) });
		if (after !== null) query.set("after", after);
		const separator = path.includes("?") ? "&" : "?";
		const res = await request.get(`${path}${separator}${query}`, {
			headers: authHeader(token),
		});
		expect(res.status()).toBe(200);
		const page = (await res.json()) as ListPage<Item>;
		expect(page.items.length).toBeLessThanOrEqual(limit);
		items.push(...page.items);
		if (page.next === null) return { items, pages };
		expect(page.items).toHaveLength(limit);
		after = page.next;
	}
}

test("GET /api/course?limit=1 answers one course and the cursor of the next page", async ({
	request,
}) => {
	const token = await adminToken(request);
	await persistedCourseFactory.create();

	const res = await request.get("/api/course?limit=1", {
		headers: authHeader(token),
	});
	expect(res.status()).toBe(200);
	const page = (await res.json()) as ListPage<CourseItem>;
	expect(Object.keys(page).sort()).toEqual(["items", "next", "prev"]);
	expect(page.items).toHaveLength(1);
	expect(typeof page.next).toBe("string");
	expect(page.next).not.toBe("");
});

test("following next from page to page reads every course once, in the order of a single page", async ({
	request,
}) => {
	const token = await adminToken(request);
	await persistedCourseFactory.create();
	await persistedCourseFactory.create();

	const whole = await walkList<CourseItem>(request, token, "/api/course", 500);
	expect(whole.pages).toBe(1);
	const keys = whole.items.map(courseKey);
	expect(keys.length).toBeGreaterThanOrEqual(3);
	expect(new Set(keys).size).toBe(keys.length);

	const oneByOne = await walkList<CourseItem>(request, token, "/api/course", 1);
	expect(oneByOne.items.map(courseKey)).toEqual(keys);
	expect(oneByOne.pages).toBe(keys.length);

	const inPairs = await walkList<CourseItem>(request, token, "/api/course", 2);
	expect(inPairs.items.map(courseKey)).toEqual(keys);
	expect(inPairs.pages).toBe(Math.ceil(keys.length / 2));
});

test("GET /api/course with a filter pages only the courses that match it", async ({
	request,
}) => {
	const token = await adminToken(request);
	const discipline = world.discipline.slug;
	const { items } = await walkList<CourseItem>(
		request,
		token,
		`/api/course?discipline=${discipline}`,
		1,
	);
	expect(items.map(courseKey)).toEqual([worldPath()]);
});

test("GET /api/course?after=<not a cursor> is a 400", async ({ request }) => {
	const token = await adminToken(request);
	const res = await request.get("/api/course?after=garbage", {
		headers: authHeader(token),
	});
	expect(res.status()).toBe(400);
});

for (const limit of [0, 501]) {
	test(`GET /api/course?limit=${limit} is a 400`, async ({ request }) => {
		const token = await adminToken(request);
		const res = await request.get(`/api/course?limit=${limit}`, {
			headers: authHeader(token),
		});
		expect(res.status()).toBe(400);
	});
}

test("a list route that does not page answers every row and a null next", async ({
	request,
}) => {
	const token = await adminToken(request);
	const slug = `qa-page-${Date.now().toString().slice(-8)}`;
	const created = await request.post("/api/discipline", {
		headers: authHeader(token),
		data: { slug, name: `QA ${slug}` },
	});
	expect(created.ok()).toBe(true);
	const discipline = await created.json();

	const one = await request.get(`/api/discipline?slugs=${slug}`, {
		headers: authHeader(token),
	});
	expect(one.status()).toBe(200);
	expect(await one.json()).toEqual({
		items: [discipline],
		next: null,
		prev: null,
	});

	const all = await request.get("/api/discipline", {
		headers: authHeader(token),
	});
	expect(all.status()).toBe(200);
	const body = (await all.json()) as ListPage<{ slug: string }>;
	expect(Object.keys(body).sort()).toEqual(["items", "next", "prev"]);
	expect(body.next).toBeNull();
	expect(body.items.map((item) => item.slug)).toContain(slug);
});

test("GET /api/user?limit=2 pages the users by username, ascending", async ({
	request,
}) => {
	const token = await adminToken(request);
	await seedUser({ role: "STUDENT" });
	await seedUser({ role: "STUDENT" });

	const res = await request.get("/api/user?limit=2", {
		headers: authHeader(token),
	});
	expect(res.status()).toBe(200);
	const first = (await res.json()) as ListPage<{ username: string }>;
	expect(first.items).toHaveLength(2);
	expect(typeof first.next).toBe("string");

	const whole = await walkList<{ username: string }>(
		request,
		token,
		"/api/user",
		500,
	);
	const usernames = whole.items.map((user) => user.username);
	expect(whole.pages).toBe(1);
	expect(usernames).toEqual([...usernames].sort());
	expect(new Set(usernames).size).toBe(usernames.length);
	expect(first.items.map((user) => user.username)).toEqual(
		usernames.slice(0, 2),
	);

	const inPairs = await walkList<{ username: string }>(
		request,
		token,
		"/api/user",
		2,
	);
	expect(inPairs.items.map((user) => user.username)).toEqual(usernames);
	expect(inPairs.pages).toBe(Math.ceil(usernames.length / 2));
});
