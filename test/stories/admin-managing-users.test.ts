import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/core/actor";
import { inviteService } from "@/db/services/invite.service";
import { persistedInviteFactory } from "@/fixtures/invite.factory";
import { fillField, logIn, logInAs, resetDatabase, seedUser } from "./helpers";

test.beforeEach(resetDatabase);

test("admin: invite an instructor", async ({ page }) => {
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

test("admin: see every invite that is outstanding", async ({ page }) => {
	const admin = await seedUser({ role: "ADMIN", name: "Grace Admin" });
	const recruiter = await seedUser({ role: "ADMIN", name: "Ada Recruiter" });
	const invited = "waiting-instructor@codehood.test";

	// Background: someone already issued an invite before the admin looks —
	// the admin didn't create this one, so the view has to say who did.
	await persistedInviteFactory.create({
		email: invited,
		invitedRole: "INSTRUCTOR",
		maxUses: 1,
		createdBy: { username: recruiter.username, name: recruiter.name },
	});

	await logInAs(page, admin);
	await page.goto("/admin");

	const row = page.getByRole("row").filter({ hasText: invited });
	await test.step("the invite names its recipient and who sent it", async () => {
		await expect(row).toBeVisible();
		await expect(row).toContainText("Ada Recruiter");
	});

	await test.step("and how many times it has been used so far", async () => {
		await expect(row).toContainText("0 / 1");
	});
});

test("admin: find a user and end their sessions", async ({ page, browser }) => {
	const admin = await seedUser({ role: "ADMIN", name: "Grace Admin" });
	const suspect = await seedUser({
		role: "STUDENT",
		name: "Compromised Carol",
		email: "carol-compromised@codehood.test",
	});

	// Background: the account already holds a live session somewhere else —
	// the point of the story is that this session dies without the account
	// itself being touched.
	const elsewhere = await browser.newContext();
	const elsewherePage = await elsewhere.newPage();
	await logInAs(elsewherePage, suspect);
	await elsewherePage.goto("/profile");
	await expect(elsewherePage).not.toHaveURL(/\/login/);

	await logInAs(page, admin);
	await page.goto("/admin/users");

	await test.step("admin finds the account by its email and ends its sessions", async () => {
		const row = page.getByRole("row").filter({ hasText: suspect.email });
		await row
			.getByRole("button", { name: `Force logout ${suspect.name}` })
			.click();
		await page
			.locator(`#force-logout-${suspect.username}`)
			.getByRole("button", { name: "Log out" })
			.click();
		await expect(
			page.getByText("Every session for that account has been logged out."),
		).toBeVisible();
	});

	await test.step("the account still exists but its old session is dead", async () => {
		await elsewherePage.goto("/profile");
		await expect(elsewherePage).toHaveURL(/\/login/);
	});

	// The account itself is untouched — it just needs someone to log in
	// again, the same way the story says.
	await test.step("and it can still log back in", async () => {
		await logIn(elsewherePage, suspect);
	});
});
