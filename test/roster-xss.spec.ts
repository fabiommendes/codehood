import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { courseHref } from "@/urls";
import { jsonScriptPayload } from "@/utils/json-script";
import { logInAs, resetDatabase, seedUser } from "./stories/helpers";

// The roster embeds its CSV rows in a `<script type="application/json">` via
// `set:html`. `JSON.stringify` leaves `</script` intact and the HTML parser
// closes the element there whatever the `type` is, so a student's own `name`
// — `z.string().min(1)`, written by the student — used to be markup on the
// instructor's page. Not a story: no user acts this out on purpose.

const PAYLOAD = "</script><img src=x onerror=alert(1)>";

test.beforeEach(resetDatabase);

test("a student's name cannot break out of the roster's JSON payload", async ({
	page,
}) => {
	const instructor = await seedUser({ role: "INSTRUCTOR" });
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
	});
	const student = await seedUser({ role: "STUDENT", name: PAYLOAD });
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);

	await logInAs(page, instructor);
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: instructor.username,
		edition: course.edition.slug,
	});
	await page.goto(`${href}/roster`);

	await test.step("nothing was injected", async () => {
		// The payload survives as inert text — escaped in the JSON body and
		// entity-encoded in the island props — so it is the markup that must be
		// absent, not the words.
		const html = await page.content();
		expect(html).not.toContain("<img");
		expect(html).not.toContain("</script><img");
		expect(await page.locator("img").count()).toBe(0);
	});

	await test.step("the name is shown literally instead", async () => {
		await expect(
			page.getByRole("row").filter({ hasText: PAYLOAD }),
		).toBeVisible();
	});

	// The escaping has to stay reversible, or the CSV download silently ships
	// mangled names.
	await test.step("and the payload still parses back to the original", async () => {
		const rows = await page.evaluate(() =>
			JSON.parse(
				document.getElementById("roster-csv-data")?.textContent ?? "[]",
			),
		);
		expect(rows.flat()).toContain(PAYLOAD);
	});
});

test("jsonScriptPayload escapes every angle bracket and JS line terminator", () => {
	expect(jsonScriptPayload(["</script>"])).toBe('["\\u003c/script>"]');
	expect(jsonScriptPayload("a\u2028b\u2029c")).toBe('"a\\u2028b\\u2029c"');
	expect(JSON.parse(jsonScriptPayload({ name: PAYLOAD })).name).toBe(PAYLOAD);
});
