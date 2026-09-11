import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/core/actor";
import { inviteService } from "@/db/services/invite.service";
import { fillField, logInAs, resetDatabase, seedUser } from "./helpers";

test.beforeEach(resetDatabase);

test("admin: create personalized invites", async ({ page }) => {
	const admin = await seedUser({ role: "ADMIN", name: "Grace Admin" });
	const invited = "new-instructor@codehood.test";

	await logInAs(page, admin);

	await test.step("admin issues an invite to an instructor's address", async () => {
		await page.goto("/admin");
		await page.getByRole("button", { name: "Invite instructor" }).click();
		await fillField(page, "Email", invited);
		await page.getByRole("button", { name: "Generate invite link" }).click();
	});

	// The story's whole point is that the admin gets a link back to email on:
	// an invite that was created but shows no link is useless to them.
	const link = page.locator("#invite-url");
	await expect(
		page.getByText("Invite created — it expires in 7 days."),
	).toBeVisible();
	await expect(link).toHaveValue(/\/invite\/.+/);

	await test.step("the invite is listed as outstanding", async () => {
		await expect(
			page.getByRole("row").filter({ hasText: invited }),
		).toBeVisible();
	});

	await test.step("and the link lets the instructor start an account", async () => {
		const url = await link.inputValue();
		// The recipient is not the admin, and has no account yet.
		await page.context().clearCookies();
		await page.goto(url);
		await expect(page.getByText("You're accepting an invite")).toBeVisible();
		// The page names the role it grants; "instructor" alone would match the
		// surrounding copy too.
		await expect(page.locator("strong")).toHaveText("instructor");
	});

	// Issued for the address the admin typed, and for an instructor — the role
	// is fixed by the page rather than chosen, so it is worth pinning.
	const invites = await inviteService.findMany(
		{ kind: "PERSONAL" },
		FULL_ACCESS,
	);
	const stored = invites.find((invite) => invite.email === invited);
	expect(stored?.invitedRole).toBe("INSTRUCTOR");
});
