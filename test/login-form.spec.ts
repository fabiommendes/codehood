import { expect, test } from "./fixtures";
import { fillField, seedUser } from "./stories/helpers";

test.use({ javaScriptEnabled: false });

test("wrong credentials without JS: form alert, login kept, password and next carried", async ({
	page,
}) => {
	const user = await seedUser({ role: "STUDENT" });
	await page.goto("/login?next=/courses");
	await fillField(page, "Email or username", user.username);
	await fillField(page, "Password", "definitely-wrong");
	await page.getByRole("button", { name: "Log in" }).click();

	await expect(page.getByRole("alert")).toContainText(
		"Invalid email/username or password.",
	);
	await expect(page.locator("input[name=login]")).toHaveValue(user.username);
	await expect(page.locator("input[name=password]")).toHaveValue("");
	await expect(page.locator("input[name=next]")).toHaveValue("/courses");
	await expect(page.locator("input[name=login]")).not.toHaveAttribute(
		"aria-invalid",
		"true",
	);

	await fillField(page, "Password", user.password);
	await page.getByRole("button", { name: "Log in" }).click();
	await expect(page).toHaveURL(/\/courses$/);
});

for (const next of [
	"https://evil.example/",
	"//evil.example/",
	"/\\evil.example",
	"javascript:alert(1)",
]) {
	test(`next=${next} is not honoured: the form carries / instead`, async ({
		page,
	}) => {
		await page.goto(`/login?next=${encodeURIComponent(next)}`);
		await expect(page.locator("input[name=next]")).toHaveValue("/");
	});
}
