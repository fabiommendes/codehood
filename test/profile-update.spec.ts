import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { seedUser } from "./stories/helpers";

/**
 * `profile.update` asks for GitHub and school id only of students. Every row
 * here is unique per run, so there is no `resetDatabase`.
 */

/// Bearer headers of a signed-in `user`.
async function headersOf(
	request: import("@playwright/test").APIRequestContext,
	user: { username: string; password: string },
) {
	const login = await request.post("/api/auth/login", {
		data: { login: user.username, password: user.password },
	});
	expect(login.ok(), await login.text()).toBe(true);
	const { token } = await login.json();
	return { Authorization: `Bearer ${token}` };
}

test("an instructor without GitHub or school id can save the profile", async ({
	request,
}) => {
	const instructor = await seedUser({
		role: "INSTRUCTOR",
		githubId: undefined,
		schoolId: undefined,
	});
	const headers = await headersOf(request, instructor);

	const res = await request.post("/_actions/profile.update", {
		headers,
		form: {
			name: "Renamed Instructor",
			email: instructor.email,
			githubId: "",
			schoolId: "",
		},
	});
	expect(res.ok(), await res.text()).toBe(true);

	const saved = await db.user.findOne(
		{ username: instructor.username },
		FULL_ACCESS,
	);
	expect(saved?.name).toBe("Renamed Instructor");
	expect(saved?.githubId).toBeNull();
	expect(saved?.schoolId).toBeNull();
});

test("a student is refused when GitHub or school id is missing, on its own field", async ({
	request,
}) => {
	const student = await seedUser({ role: "STUDENT" });
	const headers = await headersOf(request, student);

	for (const missing of ["githubId", "schoolId"] as const) {
		const res = await request.post("/_actions/profile.update", {
			headers,
			form: {
				name: student.name,
				email: student.email,
				githubId: "someone",
				schoolId: "12345",
				[missing]: "",
			},
		});
		expect(res.status()).toBe(400);
		const body = await res.json();
		expect(body.type).toBe("AstroActionInputError");
		expect(body.fields[missing]).toEqual(["Required for students."]);
	}
});
