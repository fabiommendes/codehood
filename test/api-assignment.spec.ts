import { db } from "@/db";
import { prisma } from "@/db/client";
import {
	apiAs,
	assertNoSecrets,
	assignmentBody,
	assignmentPk,
	assignmentsUrl,
	assignmentUrl,
	disposeApiContexts,
	etagFor,
	memberUrl,
	rosterOf,
	teamsUrl,
} from "./api-assignment-support";
import { type AssignmentFixture, assignmentFixture } from "./assignment-e2e";
import {
	addRepository,
	cleanupAssignmentScenarios,
	daysFromNow,
	folderExists,
	hoursFromNow,
	tag,
} from "./assignment-scenario";
import { expect, test } from "./fixtures";

/// The assignment routes over HTTP: who may call them, the upsert contract, the
/// rules of the fields and the delete with and without `force`.

test.afterAll(async () => {
	await disposeApiContexts();
	await cleanupAssignmentScenarios();
});

/// A team made by the instructor, with the first student in it.
async function seedTeam(fixture: AssignmentFixture) {
	return db.team.createFor(
		assignmentPk(fixture),
		{ name: tag("team"), members: [rosterOf(fixture)[0].username] },
		{ actor: fixture.instructor },
	);
}

type Call = {
	label: string;
	method: "get" | "put" | "post" | "patch" | "delete";
	url: string;
	data?: unknown;
};

/// Every route of the assignments and their teams, aimed at a team and a student of the fixture.
function allRoutes(
	fixture: AssignmentFixture,
	team: { publicId: string },
	username: string,
): Call[] {
	return [
		{ label: "list", method: "get", url: assignmentsUrl(fixture) },
		{ label: "read", method: "get", url: assignmentUrl(fixture) },
		{
			label: "upsert",
			method: "put",
			url: assignmentUrl(fixture),
			data: assignmentBody(),
		},
		{ label: "delete", method: "delete", url: assignmentUrl(fixture) },
		{ label: "teams", method: "get", url: teamsUrl(fixture) },
		{
			label: "team create",
			method: "post",
			url: teamsUrl(fixture),
			data: { name: tag("t"), members: [] },
		},
		{
			label: "team patch",
			method: "patch",
			url: teamsUrl(fixture, team.publicId),
			data: { name: tag("t") },
		},
		{
			label: "team delete",
			method: "delete",
			url: teamsUrl(fixture, team.publicId),
		},
		{
			label: "member put",
			method: "put",
			url: memberUrl(fixture, team.publicId, username),
		},
		{
			label: "member delete",
			method: "delete",
			url: memberUrl(fixture, team.publicId, username),
		},
	];
}

test.describe("permissions", () => {
	test("without a key every route answers 401", async ({ playwright }) => {
		const fixture = await assignmentFixture();
		const team = await seedTeam(fixture);
		const anonymous = await apiAs(playwright, null);

		const statuses: Record<string, number> = {};
		for (const call of allRoutes(
			fixture,
			team,
			rosterOf(fixture)[0].username,
		)) {
			// A body gives the request a content type: without one, the origin
			// check refuses a keyless request before authentication does.
			const response = await anonymous[call.method](call.url, {
				data: call.data ?? {},
			});
			statuses[call.label] = response.status();
		}

		expect(Object.values(statuses).every((status) => status === 401)).toBe(
			true,
		);
	});

	test("a student of the course reads the assignment and nothing else", async ({
		playwright,
	}) => {
		const fixture = await assignmentFixture();
		const team = await seedTeam(fixture);
		const api = await apiAs(playwright, rosterOf(fixture)[1]);

		const statuses: Record<string, number> = {};
		for (const call of allRoutes(
			fixture,
			team,
			rosterOf(fixture)[1].username,
		)) {
			const response = await api[call.method](call.url, { data: call.data });
			statuses[call.label] = response.status();
		}

		expect(statuses).toEqual({
			list: 200,
			read: 200,
			upsert: 403,
			delete: 403,
			teams: 403,
			"team create": 403,
			"team patch": 403,
			"team delete": 403,
			"member put": 403,
			"member delete": 403,
		});
	});

	test("a student sees the open assignments and not the ones that open later", async ({
		playwright,
	}) => {
		const fixture = await assignmentFixture();
		const later = tag("later");
		const instructor = await apiAs(playwright, fixture.instructor);
		const created = await instructor.put(assignmentUrl(fixture, later), {
			data: assignmentBody({ opensAt: daysFromNow(2).toISOString() }),
		});
		expect(created.status()).toBe(200);
		const student = await apiAs(playwright, rosterOf(fixture)[0]);

		const list = await (await student.get(assignmentsUrl(fixture))).json();
		const slugs = list.items.map((item: { slug: string }) => item.slug);
		const asInstructor = await (
			await instructor.get(assignmentsUrl(fixture))
		).json();

		expect(slugs).toEqual([fixture.slug]);
		expect(
			asInstructor.items.map((item: { slug: string }) => item.slug).sort(),
		).toEqual([fixture.slug, later].sort());
		expect((await student.get(assignmentUrl(fixture, later))).status()).toBe(
			404,
		);
		expect((await instructor.get(assignmentUrl(fixture, later))).status()).toBe(
			200,
		);
	});

	for (const who of ["outsider", "other instructor"] as const) {
		test(`the ${who} reaches no route of another course`, async ({
			playwright,
		}) => {
			const fixture = await assignmentFixture();
			const team = await seedTeam(fixture);
			const other = await assignmentFixture();
			const user = who === "outsider" ? fixture.outsider : other.instructor;
			const api = await apiAs(playwright, user);

			for (const call of allRoutes(
				fixture,
				team,
				rosterOf(fixture)[0].username,
			)) {
				const response = await api[call.method](call.url, { data: call.data });
				expect([403, 404], `${who}: ${call.label}`).toContain(
					response.status(),
				);
			}
			expect(await prisma.team.count({ where: { id: team.id } })).toBe(1);
			expect(
				await prisma.assignment.count({ where: { id: fixture.assignment.id } }),
			).toBe(1);
		});
	}

	test("the instructor of the course reaches every route", async ({
		playwright,
	}) => {
		const fixture = await assignmentFixture();
		const team = await seedTeam(fixture);
		const student = rosterOf(fixture)[1].username;
		const api = await apiAs(playwright, fixture.instructor);
		const routes = allRoutes(fixture, team, student);
		const by = (label: string) =>
			routes.find((call) => call.label === label) as Call;

		// Destructive routes run last and in an order that keeps each one valid.
		const order = [
			"list",
			"read",
			"upsert",
			"teams",
			"team create",
			"team patch",
			"member put",
			"member delete",
			"team delete",
			"delete",
		];
		for (const label of order) {
			const call = by(label);
			// "team create" left a team behind, so the assignment goes by force.
			const url = label === "delete" ? `${call.url}?force=true` : call.url;
			const response = await api[call.method](url, { data: call.data });
			expect(response.status(), label).toBe(200);
		}
	});
});

test.describe("upsert", () => {
	test("two equal PUTs leave one row with the same content", async ({
		playwright,
	}) => {
		const fixture = await assignmentFixture();
		const api = await apiAs(playwright, fixture.instructor);
		const slug = tag("idem");
		const body = assignmentBody();

		const first = await api.put(assignmentUrl(fixture, slug), { data: body });
		const second = await api.put(assignmentUrl(fixture, slug), { data: body });

		expect(first.status()).toBe(200);
		expect(second.status()).toBe(200);
		const { updatedAt: _a, ...one } = await first.json();
		const { updatedAt: _b, ...two } = await second.json();
		expect(two).toEqual(one);
		expect(one.slug).toBe(slug);
		expect(
			await prisma.assignment.count({
				where: { courseId: fixture.courseId, slug },
			}),
		).toBe(1);
	});

	test("an old If-Match is refused with 412 and the current one passes", async ({
		playwright,
	}) => {
		const fixture = await assignmentFixture();
		const api = await apiAs(playwright, fixture.instructor);
		const url = assignmentUrl(fixture);
		const current = await (await api.get(url)).json();

		const stale = await api.put(url, {
			data: assignmentBody({ title: "Stale" }),
			headers: { "If-Match": etagFor("2000-01-01T00:00:00.000Z") },
		});
		const fresh = await api.put(url, {
			data: assignmentBody({ title: "Fresh" }),
			headers: { "If-Match": etagFor(current.updatedAt) },
		});

		expect(stale.status()).toBe(412);
		expect(fresh.status()).toBe(200);
		expect((await fresh.json()).title).toBe("Fresh");
	});

	test("If-None-Match: * creates a new slug and is refused on an existing one", async ({
		playwright,
	}) => {
		const fixture = await assignmentFixture();
		const api = await apiAs(playwright, fixture.instructor);
		const headers = { "If-None-Match": "*" };

		const created = await api.put(assignmentUrl(fixture, tag("new")), {
			data: assignmentBody(),
			headers,
		});
		const existing = await api.put(assignmentUrl(fixture), {
			data: assignmentBody({ title: "Overwritten" }),
			headers,
		});

		expect(created.status()).toBe(200);
		expect(existing.status()).toBe(412);
		const kept = await (await api.get(assignmentUrl(fixture))).json();
		expect(kept.title).not.toBe("Overwritten");
	});

	test("the template travels as the slug of a repository", async ({
		playwright,
	}) => {
		const fixture = await assignmentFixture();
		const api = await apiAs(playwright, fixture.instructor);
		const repository = await addRepository(fixture, {
			"README.md": "# Base\n",
		});

		const put = await api.put(assignmentUrl(fixture), {
			data: assignmentBody({ template: repository.slug }),
		});
		const read = await (await api.get(assignmentUrl(fixture))).json();

		expect(put.status()).toBe(200);
		expect((await put.json()).template).toBe(repository.slug);
		expect(read.template).toBe(repository.slug);
	});

	test("a template slug that names no repository is a 400 on the template", async ({
		playwright,
	}) => {
		const fixture = await assignmentFixture();
		const api = await apiAs(playwright, fixture.instructor);

		const response = await api.put(assignmentUrl(fixture), {
			data: assignmentBody({ template: tag("ghost") }),
		});

		expect(response.status()).toBe(400);
		expect(JSON.stringify(await response.json())).toContain("template");
	});

	test("an extension given to a team survives a PUT of the assignment", async ({
		playwright,
	}) => {
		const fixture = await assignmentFixture();
		const api = await apiAs(playwright, fixture.instructor);
		const team = await seedTeam(fixture);
		const plain = await db.team.createFor(
			assignmentPk(fixture),
			{ name: tag("plain"), members: [] },
			{ actor: fixture.instructor },
		);
		const extension = daysFromNow(20).toISOString();
		const patched = await api.patch(teamsUrl(fixture, team.publicId), {
			data: { dueAt: extension },
		});
		expect(patched.status()).toBe(200);

		const newDue = daysFromNow(9).toISOString();
		const put = await api.put(assignmentUrl(fixture), {
			data: assignmentBody({ dueAt: newDue }),
		});
		const listed = await (await api.get(teamsUrl(fixture))).json();

		expect(put.status()).toBe(200);
		const byId = new Map(
			listed.items.map((item: { publicId: string }) => [item.publicId, item]),
		) as Map<string, { dueAt: string; extended: boolean }>;
		expect(new Date(byId.get(team.publicId)?.dueAt ?? 0).toISOString()).toBe(
			extension,
		);
		expect(byId.get(team.publicId)?.extended).toBe(true);
		expect(new Date(byId.get(plain.publicId)?.dueAt ?? 0).toISOString()).toBe(
			newDue,
		);
		expect(byId.get(plain.publicId)?.extended).toBe(false);
	});

	test("a team deadline in the body of the PUT writes nothing to the team", async ({
		playwright,
	}) => {
		const fixture = await assignmentFixture();
		const api = await apiAs(playwright, fixture.instructor);
		const team = await seedTeam(fixture);
		const before = await prisma.team.findUniqueOrThrow({
			where: { id: team.id },
			select: { dueAt: true },
		});

		const put = await api.put(assignmentUrl(fixture), {
			data: assignmentBody({
				teamDueAt: daysFromNow(30).toISOString(),
				teams: [
					{ publicId: team.publicId, dueAt: daysFromNow(30).toISOString() },
				],
			}),
		});

		// Unknown fields are dropped (200) or refused (400); either way no team changes.
		expect([200, 400]).toContain(put.status());
		const after = await prisma.team.findUniqueOrThrow({
			where: { id: team.id },
			select: { dueAt: true },
		});
		expect(after.dueAt).toEqual(before.dueAt);
	});
});

test.describe("field rules", () => {
	test("a due date after the closing date is a 400 on closesAt", async ({
		playwright,
	}) => {
		const fixture = await assignmentFixture();
		const api = await apiAs(playwright, fixture.instructor);

		const response = await api.put(assignmentUrl(fixture), {
			data: assignmentBody({
				dueAt: daysFromNow(7).toISOString(),
				closesAt: daysFromNow(3).toISOString(),
			}),
		});

		expect(response.status()).toBe(400);
		expect(JSON.stringify(await response.json())).toContain("closesAt");
	});

	test("teamMin above teamMax is a 400 on teamMax", async ({ playwright }) => {
		const fixture = await assignmentFixture();
		const api = await apiAs(playwright, fixture.instructor);

		const response = await api.put(assignmentUrl(fixture), {
			data: assignmentBody({ teamMin: 4, teamMax: 2 }),
		});

		expect(response.status()).toBe(400);
		expect(JSON.stringify(await response.json())).toContain("teamMax");
	});

	test("restrictions above the limits of the instance are a 400", async ({
		playwright,
	}) => {
		const fixture = await assignmentFixture();
		const api = await apiAs(playwright, fixture.instructor);

		const response = await api.put(assignmentUrl(fixture), {
			data: assignmentBody({
				restrictions: { maxFileBytes: Number.MAX_SAFE_INTEGER },
			}),
		});

		expect(response.status()).toBe(400);
		expect(JSON.stringify(await response.json())).toContain("restrictions");
	});

	test("an opening date after the due date is a 400 on opensAt", async ({
		playwright,
	}) => {
		const fixture = await assignmentFixture();
		const api = await apiAs(playwright, fixture.instructor);

		const response = await api.put(assignmentUrl(fixture), {
			data: assignmentBody({ opensAt: hoursFromNow(24 * 8).toISOString() }),
		});

		expect(response.status()).toBe(400);
		expect(JSON.stringify(await response.json())).toContain("opensAt");
	});
});

test.describe("delete", () => {
	test("an assignment with teams is a 409 and keeps everything", async ({
		playwright,
	}) => {
		const fixture = await assignmentFixture();
		const api = await apiAs(playwright, fixture.instructor);
		const team = await seedTeam(fixture);

		const response = await api.delete(assignmentUrl(fixture));

		expect(response.status()).toBe(409);
		expect((await api.get(assignmentUrl(fixture))).status()).toBe(200);
		expect(folderExists(team)).toBe(true);
	});

	test("force removes the assignment, its teams and their folders", async ({
		playwright,
	}) => {
		const fixture = await assignmentFixture();
		const api = await apiAs(playwright, fixture.instructor);
		const team = await seedTeam(fixture);
		expect(folderExists(team)).toBe(true);

		const response = await api.delete(`${assignmentUrl(fixture)}?force=true`);

		expect(response.status()).toBe(200);
		expect((await api.get(assignmentUrl(fixture))).status()).toBe(404);
		expect(await prisma.team.count({ where: { id: team.id } })).toBe(0);
		expect(folderExists(team)).toBe(false);
	});

	test("an assignment with no teams goes without force", async ({
		playwright,
	}) => {
		const fixture = await assignmentFixture();
		const api = await apiAs(playwright, fixture.instructor);

		const response = await api.delete(assignmentUrl(fixture));

		expect(response.status()).toBe(200);
		expect((await api.get(assignmentUrl(fixture))).status()).toBe(404);
	});
});

test.describe("secrets", () => {
	test("the assignment body carries no token, join code or base commit", async ({
		playwright,
	}) => {
		const fixture = await assignmentFixture({
			template: { "README.md": "# Base\n" },
		});
		await seedTeam(fixture);
		const api = await apiAs(playwright, fixture.instructor);

		const one = await (await api.get(assignmentUrl(fixture))).json();
		const list = await (await api.get(assignmentsUrl(fixture))).json();

		assertNoSecrets(one);
		assertNoSecrets(list);
		expect(one.template).toBe(fixture.template?.slug);
	});
});

test.describe("OpenAPI", () => {
	type Operation = { parameters?: { name: string; in: string }[] };
	type Document = {
		paths: Record<string, Record<string, Operation>>;
		components?: { schemas?: Record<string, unknown> };
	};

	async function documentOf(request: {
		get(url: string): Promise<{ json(): Promise<unknown> }>;
	}): Promise<Document> {
		return (await (await request.get("/openapi.json")).json()) as Document;
	}

	const ROUTES: [RegExp, string][] = [
		[/\/assignment$/, "get"],
		[/\/assignment\/\{[^}]+\}$/, "get"],
		[/\/assignment\/\{[^}]+\}$/, "put"],
		[/\/assignment\/\{[^}]+\}$/, "delete"],
		[/\/assignment\/\{[^}]+\}\/team$/, "get"],
		[/\/assignment\/\{[^}]+\}\/team$/, "post"],
		[/\/assignment\/\{[^}]+\}\/team\/\{[^}]+\}$/, "patch"],
		[/\/assignment\/\{[^}]+\}\/team\/\{[^}]+\}$/, "delete"],
		[/\/assignment\/\{[^}]+\}\/team\/\{[^}]+\}\/member\/\{[^}]+\}$/, "put"],
		[/\/assignment\/\{[^}]+\}\/team\/\{[^}]+\}\/member\/\{[^}]+\}$/, "delete"],
	];

	test("documents the assignment and team routes", async ({ request }) => {
		const document = await documentOf(request);
		const paths = Object.keys(document.paths);

		for (const [pattern, method] of ROUTES) {
			const found = paths.find(
				(path) => pattern.test(path) && document.paths[path]?.[method],
			);
			expect(found, `${method} ${pattern}`).toBeDefined();
		}
	});

	test("force is a query parameter of the assignment DELETE", async ({
		request,
	}) => {
		const document = await documentOf(request);
		const path = Object.keys(document.paths).find((candidate) =>
			/\/assignment\/\{[^}]+\}$/.test(candidate),
		);

		const parameters = document.paths[path ?? ""]?.delete?.parameters ?? [];

		expect(parameters).toContainEqual(
			expect.objectContaining({ name: "force", in: "query" }),
		);
	});

	test("assignment and team schemas expose no token, join code or base commit", async ({
		request,
	}) => {
		const document = await documentOf(request);
		const schemas = Object.entries(document.components?.schemas ?? {}).filter(
			([name]) => /assignment|team/i.test(name),
		);
		const operations = Object.entries(document.paths).filter(([path]) =>
			/\/assignment(\/|$)/.test(path),
		);

		expect(schemas.length).toBeGreaterThan(0);
		for (const [name, schema] of schemas) assertNoSecrets(schema, name);
		for (const [path, operation] of operations)
			assertNoSecrets(operation, path);
	});
});
