import { expect, test } from "@playwright/test";

/**
 * The admin guard covers `/admin` and the paths under it, and nothing else
 * that merely starts with the same letters, such as a discipline slugged
 * `administration`.
 */

test("an anonymous visitor to /admin or a page under it is sent to /login", async ({
	request,
}) => {
	for (const path of ["/admin", "/admin/users"]) {
		const res = await request.get(path, { maxRedirects: 0 });
		expect(res.status(), path).toBe(302);
		expect(res.headers().location, path).toMatch(/^\/login/);
	}
});

test("a student on a path that only starts with the letters 'admin' is not sent to /403", async ({
	request,
}) => {
	const login = await request.post("/api/auth/login", {
		data: { login: "student", password: "student" },
	});
	expect(login.ok()).toBe(true);

	const res = await request.get("/administration/some-course", {
		maxRedirects: 0,
	});
	expect(res.headers().location ?? "").not.toMatch(/^\/403/);
});
