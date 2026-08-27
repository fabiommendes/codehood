import { type APIRequestContext, expect, test } from "@playwright/test";

async function loginAs(
	request: APIRequestContext,
	loginValue: string,
	password: string,
) {
	const res = await request.post("/_actions/auth.login", {
		form: { login: loginValue, password },
	});
	expect(res.ok()).toBe(true);
}

test("a student sees exactly their courses on /courses, and opens one to the real heading", async ({
	request,
}) => {
	await loginAs(request, "hopper", "student");

	const listing = await request.get("/courses");
	const listingHtml = await listing.text();
	expect(listingHtml).toContain("cs101");
	expect(listingHtml).not.toContain("cs201");

	const page = await request.get("/cs101/ada_2026-1");
	expect(page.status()).toBe(200);
	const html = await page.text();
	expect(html).toContain("Introduction to Programming");
});

test("a student gets a 403 naming the course on one they're not enrolled in, and a 404 on a course that doesn't exist", async ({
	request,
}) => {
	await loginAs(request, "hopper", "student");

	const forbidden = await request.get("/cs201/turing_2026-1");
	expect(forbidden.status()).toBe(403);
	expect(await forbidden.text()).toContain("turing_2026-1");

	const notFound = await request.get("/cs101/nobody_2026-1");
	expect(notFound.status()).toBe(404);
});

test("an instructor sees /manage and /roster, and the roster lists every enrolled student", async ({
	request,
}) => {
	await loginAs(request, "ada", "instructor");

	const manage = await request.get("/cs101/ada_2026-1/manage");
	expect(manage.status()).toBe(200);

	const roster = await request.get("/cs101/ada_2026-1/roster");
	expect(roster.status()).toBe(200);
	const html = await roster.text();
	for (const name of ["Grace Hopper", "Margaret Hamilton", "Barbara Liskov"]) {
		expect(html).toContain(name);
	}
});

test("a student following the instructor's /manage URL gets a 403", async ({
	request,
}) => {
	await loginAs(request, "hopper", "student");
	const manage = await request.get("/cs101/ada_2026-1/manage");
	expect(manage.status()).toBe(403);
});

test("redeeming a classroom invite enrolls the student; a personal invite does not", async ({
	request,
}) => {
	await loginAs(request, "ada", "instructor");

	const invitePage = await request.post("/cs101/ada_2026-1/invite", {
		form: {},
	});
	expect(invitePage.status()).toBe(200);
	const invitePageHtml = await invitePage.text();
	const classroomTokenMatch = invitePageHtml.match(
		/value="[^"]*\/invite\/([^"]+)"/,
	);
	expect(classroomTokenMatch).not.toBeNull();
	const classroomToken = classroomTokenMatch?.[1] ?? "";

	const acceptClassroom = await request.post("/_actions/auth.acceptInvite", {
		form: {
			token: classroomToken,
			email: "e2e-classroom-student@codehood.test",
			username: "e2e-classroom-student",
			name: "E2E Classroom Student",
			password: "correcthorse",
			githubId: "e2e-classroom-student",
			schoolId: "e2e-classroom-student",
		},
	});
	expect(acceptClassroom.ok()).toBe(true);

	// The cookie jar now holds the newly enrolled student's session.
	const listing = await request.get("/courses");
	expect(await listing.text()).toContain("cs101");

	// Back to an instructor to issue a personal invite (no courseId).
	await loginAs(request, "ada", "instructor");
	const personalInvite = await request.post(
		"/_actions/auth.createPersonalInvite",
		{
			data: { email: "e2e-personal-student@codehood.test", role: "STUDENT" },
		},
	);
	expect(personalInvite.ok()).toBe(true);
	const [, personalToken] = await personalInvite.json();

	const acceptPersonal = await request.post("/_actions/auth.acceptInvite", {
		form: {
			token: personalToken,
			email: "e2e-personal-student@codehood.test",
			username: "e2e-personal-student",
			name: "E2E Personal Student",
			password: "correcthorse",
			githubId: "e2e-personal-student",
			schoolId: "e2e-personal-student",
		},
	});
	expect(acceptPersonal.ok()).toBe(true);

	const emptyListing = await request.get("/courses");
	expect(await emptyListing.text()).toContain(
		"not enrolled in or teaching any courses",
	);
});
