import { expect, test } from "@playwright/test";

test("GET /api/health reports ok with no credentials", async ({ request }) => {
	const res = await request.get("/api/health");
	expect(res.status()).toBe(200);
	expect(await res.json()).toEqual({ status: "ok", database: "ok" });
});
