import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { persistedCalendarEventFactory } from "@/fixtures/calendar-event.factory";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedUserFactory } from "@/fixtures/user.factory";
import { resetDatabase } from "./stories/helpers";

// GET /calendar/<token>.ics against the running test server.

test.beforeEach(resetDatabase);

/// Name of the session cookie, as set by `src/middleware.ts`.
const SESSION_COOKIE = "session";

/// The body with folded lines joined back.
function unfolded(body: string): string {
	return body.replaceAll("\r\n ", "");
}

/// A student enrolled in a course with one meeting titled `title`, and their feed token.
async function studentWithFeed(title: string) {
	const course = await persistedCourseFactory.create(
		{},
		{ transient: { students: 1 } },
	);
	const student = course.students[0];
	if (!student) throw new Error("the course has no enrolled student");
	await persistedCalendarEventFactory.create({ course: course.id, title });
	const feed = await db.calendarFeed.rotate(student.username, FULL_ACCESS);
	return { student, token: feed.token };
}

test("a valid token returns the owner's calendar as text/calendar, cacheable privately for five minutes", async ({
	request,
}) => {
	const { token } = await studentWithFeed("Lab Alpha");

	const response = await request.get(`/calendar/${token}.ics`);

	expect(response.status()).toBe(200);
	expect(response.headers()["content-type"]).toBe(
		"text/calendar; charset=utf-8",
	);
	expect(response.headers()["cache-control"]).toBe("private, max-age=300");
	const body = unfolded(await response.text());
	expect(body.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
	expect(body.endsWith("END:VCALENDAR\r\n")).toBe(true);
	expect(body).toContain("BEGIN:VEVENT");
	expect(body).toContain("Lab Alpha");
});

test("a rotated-away token gets a bare 404 while the new one works", async ({
	request,
}) => {
	const { student, token } = await studentWithFeed("Lab Beta");
	const next = await db.calendarFeed.rotate(student.username, FULL_ACCESS);

	const old = await request.get(`/calendar/${token}.ics`);
	const fresh = await request.get(`/calendar/${next.token}.ics`);

	expect(old.status()).toBe(404);
	expect(fresh.status()).toBe(200);
});

const BAD_TOKENS: [string, string][] = [
	["a well-formed token nobody holds", "no-such-token"],
	["characters outside the base64url alphabet", "bad%20token%21"],
	["more than 128 characters", "a".repeat(200)],
];

for (const [name, token] of BAD_TOKENS) {
	test(`a token with ${name} gets 404 and an empty body`, async ({
		request,
	}) => {
		const response = await request.get(`/calendar/${token}.ics`);

		expect(response.status()).toBe(404);
		expect(await response.text()).toBe("");
	});
}

test("the unknown-token and malformed-token responses are indistinguishable", async ({
	request,
}) => {
	const unknown = await request.get("/calendar/no-such-token.ics");
	const malformed = await request.get("/calendar/bad%20token%21.ics");

	expect(malformed.status()).toBe(unknown.status());
	expect(malformed.headers()["content-type"]).toBe(
		unknown.headers()["content-type"],
	);
	expect(await malformed.text()).toBe(await unknown.text());
});

test("a logged-in session of another user does not change the response", async ({
	request,
	playwright,
	baseURL,
}) => {
	const { token } = await studentWithFeed("Lab Gamma");
	const bystander = await persistedUserFactory.create();
	const { token: session } = await db.session.create(
		{ username: bystander.username },
		FULL_ACCESS,
	);
	const anonymous = await request.get(`/calendar/${token}.ics`);
	const signedIn = await playwright.request.newContext({
		baseURL,
		extraHTTPHeaders: { cookie: `${SESSION_COOKIE}=${session}` },
	});

	const response = await signedIn.get(`/calendar/${token}.ics`);

	expect(response.status()).toBe(200);
	expect(await response.text()).toBe(await anonymous.text());
	expect(unfolded(await response.text())).toContain("Lab Gamma");
	await signedIn.dispose();
});

test("a session cookie alone, without a token, opens no feed", async ({
	playwright,
	baseURL,
}) => {
	const { student } = await studentWithFeed("Lab Delta");
	const { token: session } = await db.session.create(
		{ username: student.username },
		FULL_ACCESS,
	);
	const signedIn = await playwright.request.newContext({
		baseURL,
		extraHTTPHeaders: { cookie: `${SESSION_COOKIE}=${session}` },
	});

	const response = await signedIn.get("/calendar/no-such-token.ics");

	expect(response.status()).toBe(404);
	expect(await response.text()).toBe("");
	await signedIn.dispose();
});
