import { type APIRequestContext, expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";

/**
 * Questions are addressed under their course's natural key, same as
 * resources — see `test/api-resource.spec.ts`.
 */

function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

const PASSWORD = "correct-horse-battery-staple";

async function makeUser(role: "INSTRUCTOR" | "STUDENT") {
	const username = tag(role.toLowerCase());
	return db.user.create(
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

async function makeCourse() {
	const instructor = await makeUser("INSTRUCTOR");
	const discipline = tag("disc");
	await db.discipline.create(
		{ slug: discipline, name: discipline },
		FULL_ACCESS,
	);
	if (!(await db.edition.findOne({ slug: "2026-1" }, FULL_ACCESS))) {
		await db.edition.create(
			{
				slug: "2026-1",
				name: "2026-1",
				startAt: new Date("2026-01-01"),
				endAt: new Date("2030-12-31"),
			},
			FULL_ACCESS,
		);
	}
	const course = await db.course.create(
		{
			discipline,
			instructor: instructor.username,
			edition: "2026-1",
			startAt: new Date("2026-01-01"),
			endAt: new Date("2026-05-01"),
		},
		FULL_ACCESS,
	);
	const url = `/api/course/${discipline}/${instructor.username}_2026-1/question`;
	return { instructor, course, url };
}

test("GET <slug>?public=true forces the public half even for the question's own instructor", async ({
	request,
}) => {
	const { instructor, course, url } = await makeCourse();
	await db.question.create(
		{
			courseId: course.id,
			slug: "q1",
			status: "PUBLISHED",
			version: "v1",
			question: {
				type: "true-false",
				stem: "Judge each statement.",
				choices: [
					{ id: "s0", text: "Statement 0", correct: true },
					{ id: "s1", text: "Statement 1", correct: false },
				],
			},
		},
		{ actor: instructor },
	);
	const headers = await tokenFor(request, instructor.username);

	const full = await request.get(`${url}/q1`, { headers });
	expect(full.status()).toBe(200);
	expect((await full.json()).question.choices[0]).toHaveProperty("correct");

	const forcedPublic = await request.get(`${url}/q1?public=true`, {
		headers,
	});
	expect(forcedPublic.status()).toBe(200);
	const body = await forcedPublic.json();
	expect(body.question.choices[0]).not.toHaveProperty("correct");
});
