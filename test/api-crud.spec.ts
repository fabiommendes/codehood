import { expect, test } from "@playwright/test";
import { APIS } from "@/api/registry/hook";
import { buildOpenApiDocument } from "@/api/registry/openapi-document";
import { collectSearchParams } from "@/utils/query-coerce";

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
	"time-slot",
	"user",
] as const;

async function adminToken(
	request: import("@playwright/test").APIRequestContext,
) {
	const login = await request.post("/api/auth/login", {
		data: { login: "admin", password: "admin" },
	});
	expect(login.ok()).toBe(true);
	const { token } = await login.json();
	return token as string;
}

function authHeader(token: string) {
	return { Authorization: `Bearer ${token}` };
}

for (const resource of OPTIONAL_FILTER_RESOURCES) {
	test(`GET /api/${resource} returns 200 with a JSON array`, async ({
		request,
	}) => {
		const token = await adminToken(request);
		const res = await request.get(`/api/${resource}`, {
			headers: authHeader(token),
		});
		expect(res.status()).toBe(200);
		expect(Array.isArray(await res.json())).toBe(true);
	});
}

// Unlike the resources above, `apiKeyFilter` requires `createdById` — there is
// no "list every API key" endpoint by design — so a bare `GET /api/api-key`
// legitimately 400s even after the fix. This is not bug (a): it's the
// filter schema doing its job. Supply the required filter instead.
test("GET /api/api-key?createdById=<username> returns 200 with a JSON array", async ({
	request,
}) => {
	const token = await adminToken(request);
	const admin = await request.get("/api/user?usernames=admin", {
		headers: authHeader(token),
	});
	expect(admin.status()).toBe(200);
	const [adminUser] = await admin.json();

	const res = await request.get(
		`/api/api-key?createdById=${adminUser.username}`,
		{
			headers: authHeader(token),
		},
	);
	expect(res.status()).toBe(200);
	expect(Array.isArray(await res.json())).toBe(true);
});

// A course is addressed by its natural key, the same `<discipline>/<username>_<edition>`
// the web app uses, and no longer by its autoincrement id. The three status
// codes below are the substance of that change: a segment that doesn't match
// the grammar is a client bug (400), one that does but names nothing is a miss
// (404), and a course you may not see is a refusal (403). The web app rounds
// the first down to 404 on purpose; the API does not. See
// docs/design/url-structure.md.
test("GET /api/course/[discipline]/[course] resolves a course by its natural key", async ({
	request,
}) => {
	const token = await adminToken(request);
	const list = await request.get("/api/course", { headers: authHeader(token) });
	expect(list.status()).toBe(200);
	const [course] = await list.json();
	expect(course).toBeTruthy();

	const res = await request.get(
		`/api/course/${course.discipline.slug}/${course.instructor.username}_${course.edition.slug}`,
		{ headers: authHeader(token) },
	);
	expect(res.status()).toBe(200);
	const body = await res.json();
	expect(Array.isArray(body)).toBe(false);
	expect(body.id).toBe(course.id);
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
		const [first] = await list.json();
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

// JSON has no date type, so a create/update schema that declares a bare
// `z.date()` can never be satisfied over HTTP — the body always carries a
// string. These POST bodies must be accepted and the dates round-tripped.
test("POST /api/course accepts ISO date strings for startAt/endAt", async ({
	request,
}) => {
	const token = await adminToken(request);
	const [discipline] = await (
		await request.get("/api/discipline", { headers: authHeader(token) })
	).json();
	const [edition] = await (
		await request.get("/api/edition", { headers: authHeader(token) })
	).json();

	const startAt = "2031-01-06T00:00:00.000Z";
	const endAt = "2031-06-30T00:00:00.000Z";
	const res = await request.post("/api/course", {
		headers: authHeader(token),
		data: {
			discipline: discipline.slug,
			instructor: "ada",
			edition: edition.slug,
			description: "created by api-crud.spec",
			startAt,
			endAt,
		},
	});
	expect(res.status()).toBe(200);
	const body = await res.json();
	expect(new Date(body.startAt).toISOString()).toBe(startAt);
	expect(new Date(body.endAt).toISOString()).toBe(endAt);
});

test("GET /api/calendar-event returns 200 with a JSON array", async ({
	request,
}) => {
	const token = await adminToken(request);
	const res = await request.get("/api/calendar-event", {
		headers: authHeader(token),
	});
	expect(res.status()).toBe(200);
	expect(Array.isArray(await res.json())).toBe(true);
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
	expect(body.map((d: { slug: string }) => d.slug)).toEqual([slugA]);
});

test("a query filter that matches nothing returns an empty array, not everything", async ({
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
	expect(await res.json()).toEqual([]);
});

test("?active=false is honored as false, not truthy — a naive Boolean('false') would wrongly read it as true", async ({
	request,
}) => {
	const token = await adminToken(request);
	// "2026-1" is the seeded demo edition (src/db/bootstrap.ts), fixed safely
	// in the past so it always reads as inactive — no need to create our own
	// (editionCreate's `startAt`/`endAt` are `z.date()`, not `z.coerce.date()`,
	// so a JSON `POST` body can't carry them as strings over HTTP; a separate,
	// pre-existing gap unrelated to this fix).
	const slug = "2026-1";

	// The edition's window is entirely in the past, so it is not "active"
	// right now. `active=true` must exclude it...
	const activeOnly = await request.get(
		`/api/edition?slugs=${slug}&active=true`,
		{ headers: authHeader(token) },
	);
	expect(activeOnly.status()).toBe(200);
	expect(await activeOnly.json()).toEqual([]);

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
	expect(body.map((e: { slug: string }) => e.slug)).toEqual([slug]);
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
	expect(await res.json()).toEqual([]);
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
	expect((await everything.json()).length).toBeGreaterThan(0);

	const qs = new URLSearchParams({ slugs: "' OR 1=1--" }).toString();
	const res = await request.get(`/api/discipline?${qs}`, {
		headers: authHeader(token),
	});
	// Prisma parameterizes the query either way, so this can only ever be a
	// literal (non-matching) string comparison — never a 500, and never the
	// full table.
	expect(res.status()).toBe(200);
	expect(await res.json()).toEqual([]);
});
