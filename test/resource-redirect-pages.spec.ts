import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { courseHref } from "@/urls";
import { resetDatabase, seedUser } from "./stories/helpers";

test.beforeEach(resetDatabase);

/// Mirrors `SESSION_COOKIE` in `src/middleware.ts`.
const SESSION_COOKIE = "session";

/// The headers of a request made as `user`, with a genuine session.
/// These tests read raw responses, so they go through the `request` fixture
/// and need no browser.
async function sessionHeaders(user: { username: string }) {
	const { token } = await db.session.create(
		{ username: user.username },
		FULL_ACCESS,
	);
	return { cookie: `${SESSION_COOKIE}=${token}` };
}

/// An enrolled student and a course with one resource of each type.
async function setup() {
	const student = await seedUser({ role: "STUDENT" });
	const course = await persistedCourseFactory.create();
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});
	const add = (
		slug: string,
		title: string,
		data: Parameters<typeof db.resource.create>[0]["data"],
	) =>
		db.resource.create({ course: course.id, slug, title, data }, FULL_ACCESS);
	const headers = await sessionHeaders(student);
	return { course, href, add, headers };
}

test("a FILE resource's page redirects to its download", async ({
	request,
}) => {
	const { href, add, headers } = await setup();
	const file = await add("slides", "Slides", {
		type: "FILE",
		filename: "slides.pdf",
		buffer: Buffer.from("%PDF-1.4 redirect test"),
	});
	if (file.data.type !== "FILE") throw new Error("expected a FILE resource");

	const response = await request.get(`${href}/resources/slides`, {
		headers,
		maxRedirects: 0,
	});

	expect([302, 303]).toContain(response.status());
	const location = new URL(
		response.headers().location ?? "",
		"http://localhost",
	);
	expect(location.pathname).toBe(
		new URL(file.data.link, "http://localhost").pathname,
	);
});

test("a LINK resource's page redirects to its url", async ({ request }) => {
	const { href, add, headers } = await setup();
	await add("reference", "Reference", {
		type: "LINK",
		url: "https://example.com/reference",
	});

	const response = await request.get(`${href}/resources/reference`, {
		headers,
		maxRedirects: 0,
	});

	expect([302, 303]).toContain(response.status());
	expect(response.headers().location).toBe("https://example.com/reference");
});

for (const [kind, data, text] of [
	["MD", { type: "MD" as const, content: "# Hello note" }, "Hello note"],
	[
		"CODE",
		{ type: "CODE" as const, language: "python", content: "print(12345)" },
		"12345",
	],
] as const) {
	test(`a ${kind} resource's page still renders instead of redirecting`, async ({
		request,
	}) => {
		const { href, add, headers } = await setup();
		await add("item", "Item", data);

		const response = await request.get(`${href}/resources/item`, {
			headers,
			maxRedirects: 0,
		});

		expect(response.status()).toBe(200);
		expect(await response.text()).toContain(text);
	});
}

test("a resource slug that does not exist is still a 404", async ({
	request,
}) => {
	const { href, headers } = await setup();

	const response = await request.get(`${href}/resources/nope`, {
		headers,
		maxRedirects: 0,
	});

	expect(response.status()).toBe(404);
});

for (const [kind, data] of [
	[
		"FILE",
		{
			type: "FILE" as const,
			filename: "slides.pdf",
			buffer: Buffer.from("%PDF-1.4 private"),
		},
	],
	["LINK", { type: "LINK" as const, url: "https://example.com/private" }],
] as const) {
	test(`a student of another course is refused a ${kind} resource, not redirected`, async ({
		request,
	}) => {
		const { href, add } = await setup();
		await add("private", "Private", data);
		const outsider = await seedUser({ role: "STUDENT" });
		const outsiderHeaders = await sessionHeaders(outsider);

		const response = await request.get(`${href}/resources/private`, {
			headers: outsiderHeaders,
			maxRedirects: 0,
		});

		// The course gate answers 403 today; what matters is that no redirect leaks
		// the download or the url.
		expect([403, 404]).toContain(response.status());
		expect(response.headers().location).toBeUndefined();
	});
}
