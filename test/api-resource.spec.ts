import { type APIRequestContext, expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/core/actor";
import { courseService } from "@/db/services/course.service";
import { disciplineService } from "@/db/services/discipline.service";
import { editionService } from "@/db/services/edition.service";
import { resourceService } from "@/db/services/resource.service";
import { userService } from "@/db/services/user.service";

/**
 * Resources are addressed under their course's natural key,
 * `/api/course/<discipline>/<instructor>_<edition>/resource[/<slug>]`, so the
 * CLI never needs a numeric id (FR-SYNC-010). See
 * dev/specs/to-do/course-scoped-resource-api.md.
 */

function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

const PASSWORD = "correct-horse-battery-staple";

async function makeUser(role: "INSTRUCTOR" | "STUDENT") {
	const username = tag(role.toLowerCase());
	return userService.create(
		{
			email: `${username}@codehood.test`,
			username,
			name: username,
			role,
			password: PASSWORD,
			githubId: username,
			schoolId: username,
		},
		FULL_ACCESS,
	);
}

async function tokenFor(request: APIRequestContext, username: string) {
	const login = await request.post("/api/auth/login", {
		data: { login: username, password: PASSWORD },
	});
	expect(login.ok()).toBe(true);
	const { token } = await login.json();
	return { Authorization: `Bearer ${token}` };
}

/** A fresh course taught by a fresh instructor, and its REST collection URL. */
async function makeCourse() {
	const instructor = await makeUser("INSTRUCTOR");
	const discipline = tag("disc");
	await disciplineService.create(
		{ slug: discipline, name: discipline },
		FULL_ACCESS,
	);
	if (!(await editionService.findOne({ slug: "2026-1" }))) {
		await editionService.create(
			{
				slug: "2026-1",
				name: "2026-1",
				startAt: new Date("2026-01-01"),
				endAt: new Date("2030-12-31"),
			},
			FULL_ACCESS,
		);
	}
	const course = await courseService.create(
		{
			discipline,
			instructor: instructor.username,
			edition: "2026-1",
			startAt: new Date("2026-01-01"),
			endAt: new Date("2026-05-01"),
		},
		FULL_ACCESS,
	);
	const url = `/api/course/${discipline}/${instructor.username}_2026-1/resource`;
	return { instructor, course, url };
}

function link(title = "Syllabus") {
	return {
		type: "LINK" as const,
		title,
		data: "https://example.com",
		contentHash: tag("h"),
	};
}

test("GET lists a course's resources and GET <slug> reads one, by natural key", async ({
	request,
}) => {
	const { instructor, course, url } = await makeCourse();
	const created = await resourceService.create(
		{ courseId: course.id, slug: "syllabus", ...link() },
		{ actor: instructor },
	);
	const headers = await tokenFor(request, instructor.username);

	const list = await request.get(url, { headers });
	expect(list.status()).toBe(200);
	expect((await list.json()).map((r: { slug: string }) => r.slug)).toEqual([
		"syllabus",
	]);

	const one = await request.get(`${url}/syllabus`, { headers });
	expect(one.status()).toBe(200);
	expect((await one.json()).id).toBe(created.id);
});

test("/api/resource is gone", async ({ request }) => {
	const { instructor } = await makeCourse();
	const headers = await tokenFor(request, instructor.username);
	expect((await request.get("/api/resource", { headers })).status()).toBe(404);
	expect((await request.get("/api/resource/1", { headers })).status()).toBe(
		404,
	);
});

test("POST creates, PATCH updates and DELETE removes a resource, all under the course path", async ({
	request,
}) => {
	const { instructor, url } = await makeCourse();
	const headers = await tokenFor(request, instructor.username);

	const created = await request.post(url, {
		headers,
		data: { slug: "notes", ...link("Before") },
	});
	expect(created.status()).toBe(200);
	expect((await created.json()).slug).toBe("notes");

	const patched = await request.patch(`${url}/notes`, {
		headers,
		data: { title: "After" },
	});
	expect(patched.status()).toBe(200);
	expect((await patched.json()).title).toBe("After");

	const deleted = await request.delete(`${url}/notes`, { headers });
	expect(deleted.status()).toBe(200);
	expect((await request.get(`${url}/notes`, { headers })).status()).toBe(404);
});

test("POST ignores a courseId in the body: the path names the course", async ({
	request,
}) => {
	const { instructor, course, url } = await makeCourse();
	const other = await makeCourse();
	const headers = await tokenFor(request, instructor.username);

	const res = await request.post(url, {
		headers,
		data: { courseId: other.course.id, slug: "pinned", ...link() },
	});
	expect(res.status()).toBe(200);
	expect((await res.json()).courseId).toBe(course.id);
});

test("status codes: 400 malformed segment or slug, 404 no course or no slug, 403 a course the actor cannot see", async ({
	request,
}) => {
	const { instructor, url } = await makeCourse();
	const outsider = await makeUser("STUDENT");
	const mine = await tokenFor(request, instructor.username);
	const theirs = await tokenFor(request, outsider.username);
	const ghost = url.replace(
		/\/api\/course\/[^/]+\//,
		`/api/course/${tag("nope")}/`,
	);

	const cases: [string, Promise<{ status(): number }>, number][] = [
		[
			"malformed course",
			request.get("/api/course/cs101/no-underscore/resource", {
				headers: mine,
			}),
			400,
		],
		[
			"malformed slug",
			request.get(`${url}/Not_A_Slug`, { headers: mine }),
			400,
		],
		["no such course, list", request.get(ghost, { headers: mine }), 404],
		[
			"no such course, item",
			request.get(`${ghost}/syllabus`, { headers: mine }),
			404,
		],
		[
			"no such slug, read",
			request.get(`${url}/missing`, { headers: mine }),
			404,
		],
		[
			"no such slug, update",
			request.patch(`${url}/missing`, { headers: mine, data: { title: "x" } }),
			404,
		],
		[
			"no such slug, delete",
			request.delete(`${url}/missing`, { headers: mine }),
			404,
		],
		["invisible course, list", request.get(url, { headers: theirs }), 403],
		[
			"invisible course, item",
			request.get(`${url}/missing`, { headers: theirs }),
			403,
		],
	];
	for (const [label, response, status] of cases) {
		expect.soft((await response).status(), label).toBe(status);
	}
});

test("PUT <slug> creates on the first call and updates the same resource on the next, taking slug and course from the path", async ({
	request,
}) => {
	const { instructor, course, url } = await makeCourse();
	const headers = await tokenFor(request, instructor.username);

	const first = await request.put(`${url}/toolchain`, {
		headers,
		data: link("Before"),
	});
	expect(first.status()).toBe(200);
	const created = await first.json();
	expect(created).toMatchObject({ slug: "toolchain", courseId: course.id });

	const again = await request.put(`${url}/toolchain`, {
		headers,
		data: link("After"),
	});
	expect(again.status()).toBe(200);
	expect(await again.json()).toMatchObject({ id: created.id, title: "After" });

	const list = await (await request.get(url, { headers })).json();
	expect(list).toHaveLength(1);
});
