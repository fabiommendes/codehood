import type { UserActor } from "@/auth/actor";
import { prisma } from "@/db/client";
import { expect, test } from "../fixtures";
import {
	changeWork,
	createTeamAs,
	daysFromNow,
	deliver,
	extendTeam,
	hoursFromNow,
	seedAssignment,
	seedWorld,
	shortSha,
	stopDelivering,
	student,
	tempTokenOf,
	tokenOf,
} from "./assignment-support";
import { logInAs, resetDatabase } from "./helpers";

/*
 * UI contract assumed by these stories (en build).
 *
 * List (`<course>/assignments`)
 *   - Heading "Assignments"; Exams is the current tab.
 *   - One list item per visible assignment holding a link named after its
 *     title, a line "Teams of <min> to <max>" or "Individual", and the
 *     reader's status badge: "No team" (individual: "No repository"), "No push",
 *     "Delivered on time", "Late delivery", "No delivery on time", "Closed".
 *
 * Page (`<course>/assignments/<slug>`; 404 while the assignment is not open)
 *   - Heading with the assignment title, the status badge beside it, a link
 *     "Assignments" back to the list.
 *   - Delivery cards, each a region named by its heading: "Delivered on time",
 *     "Late delivery", "No delivery on time". A card with a commit shows the
 *     short sha (7 characters), the commit message and the pusher's full name.
 *     "Delivered on time" has a "Pinned" badge once the due date has passed,
 *     and a note starting "New pushes" before it ("your delivery" on an
 *     individual assignment). Without any push before the due date, the page
 *     has the card "Nothing delivered yet" until then.
 *   - Alerts (role alert): "The due date has passed" (until pushes close) and
 *     "Pushes closed on <date>. Cloning is still available." (after).
 *   - Panel, a region named "Your team" (team assignments) or "Your repository"
 *     (individual ones), with a heading:
 *       - no team: "Your team" with a heading "Create a team" (textbox "Team
 *         name", button "Create team") and a heading "Join with a code"
 *         (textbox "Team code", button "Join team"). After `teamsLockAt` an
 *         alert "... Ask your instructor ..." replaces both forms.
 *       - no repository (individual): heading "Your repository" and a button
 *         "Create my repository".
 *       - in a team: heading "Team <name>"; one list item per member with the
 *         full name and the word "you" on the reader's; the text
 *         "Code to join: <code>" until teams lock; an alert
 *         "Incomplete team: the minimum is <n> members ..." when below the
 *         minimum; an alert "Required files missing from main" listing the
 *         paths as list items; a region "Clone the repository" with the text
 *         `git clone <origin>/git/<token>/<slug>.git` and a button "Copy"; a
 *         heading "First push" while there are no pushes; a region "Push
 *         history" with one list item per push (short sha, message, pusher's
 *         name, badge "Late" after the due date); a button "Generate new
 *         clone URL" that replaces the token at once; a button "Generate
 *         temporary clone URL" beside a note on shared computers and "2
 *         hours", which adds a region "Temporary clone URL" (the command with
 *         another token, a button "Copy", the text "stops working on <date>")
 *         and a button "Revoke temporary URL"; a button "Leave team"
 *         (disabled, next to a note containing "last member", for the last
 *         member of a team with pushes; absent on individual assignments).
 *   - Region "Deadlines" with the due date labelled "Due date" ("Your team's
 *     due date" when the team has an extension, "Your due date" individually)
 *     and, when extended, the words "extended" and "original".
 *   - Region "Statement" with the rendered markdown of the body.
 *   - On an individual assignment nothing on the page (`main`) says "team".
 *   - Checkpoints: the region "Deadlines" names each one by its title, with
 *     the word "checkpoint". The panel has a region "Checkpoints" with one
 *     list item per checkpoint: "Not reached yet" before its date; the short
 *     sha and the pusher's name once it has passed; "Passed with no push"
 *     when nothing had been pushed by then. In "Push history" the push that
 *     counts for a checkpoint holds its title.
 */

test.beforeEach(resetDatabase);
test.afterAll(stopDelivering);

test("student: Form a team and follow the delivery", async ({ page }) => {
	const world = await seedWorld("sa", [
		"Ana Souza",
		"Ben Carter",
		"Cai Ferreira",
		"Dan Okoye",
	]);
	const [ana, ben, cai, dan] = [1, 2, 3, 4].map((n) => student(world, n)) as [
		UserActor,
		UserActor,
		UserActor,
		UserActor,
	];
	const work = await seedAssignment(world, "sa-calc", {
		title: "Calculator",
		teamMin: 2,
		teamMax: 2,
		restrictions: { require: ["README.md"] },
	});
	await createTeamAs(work, dan, "Alpha");
	const url = `${world.href}/assignments/sa-calc`;
	const panel = page.getByRole("region", { name: "Your team" });

	await test.step("the list shows the assignment as waiting for a team", async () => {
		await logInAs(page, ana);
		await page.goto(`${world.href}/assignments`);
		await expect(
			page.getByRole("heading", { name: "Assignments" }),
		).toBeVisible();
		const item = page.getByRole("listitem").filter({ hasText: "Calculator" });
		await expect(item).toContainText("No team");
		await item.getByRole("link", { name: /Calculator/ }).click();
		await expect(page).toHaveURL(url);
		await expect(
			page.getByRole("heading", { name: "Calculator" }),
		).toBeVisible();
	});

	await test.step("an empty name and a name already taken are refused", async () => {
		await panel.getByRole("button", { name: "Create team" }).click();
		await expect(panel.getByText("Required")).toBeVisible();
		await expect(panel.getByRole("heading", { name: /^Team / })).toHaveCount(0);

		await panel.getByRole("textbox", { name: "Team name" }).fill("Alpha");
		await panel.getByRole("button", { name: "Create team" }).click();
		await expect(
			page.getByText("Another team of this assignment has this name."),
		).toBeVisible();
		await expect(panel.getByRole("heading", { name: /^Team / })).toHaveCount(0);
		expect(await prisma.team.count()).toBe(1);
	});

	let code = "";
	await test.step("creating the team shows its code, the clone URL and the size warning", async () => {
		await panel.getByRole("textbox", { name: "Team name" }).fill("Compilers");
		await panel.getByRole("button", { name: "Create team" }).click();

		await expect(
			panel.getByRole("heading", { name: "Team Compilers" }),
		).toBeVisible();
		await expect(
			panel.getByRole("listitem").filter({ hasText: ana.name }),
		).toContainText("you");
		const team = await prisma.team.findFirstOrThrow({
			where: { name: "Compilers" },
			select: { joinCode: true },
		});
		code = team.joinCode ?? "";
		await expect(panel.getByText(`Code to join: ${code}`)).toBeVisible();
		await expect(panel.getByText(/Incomplete team/)).toBeVisible();

		const mine = await prisma.team.findFirstOrThrow({
			where: { name: "Compilers" },
		});
		const token = await tokenOf(mine, ana.username);
		await expect(
			panel.getByRole("region", { name: "Clone the repository" }),
		).toContainText(`git clone`);
		await expect(
			panel.getByRole("region", { name: "Clone the repository" }),
		).toContainText(`/git/${token}/sa-calc.git`);
		await expect(
			panel.getByRole("heading", { name: "First push" }),
		).toBeVisible();
		await expect(page.getByText("Nothing delivered yet")).toBeVisible();
	});

	await test.step("a classmate who types a wrong code is told, then joins with the right one", async () => {
		await logInAs(page, ben);
		await page.goto(url);
		await panel.getByRole("textbox", { name: "Team code" }).fill("ZZZZZZZZ");
		await panel.getByRole("button", { name: "Join team" }).click();
		await expect(
			page.getByText("No team of this assignment has this code."),
		).toBeVisible();

		await panel
			.getByRole("textbox", { name: "Team code" })
			.fill(code.toLowerCase());
		await panel.getByRole("button", { name: "Join team" }).click();
		await expect(
			panel.getByRole("heading", { name: "Team Compilers" }),
		).toBeVisible();
		await expect(panel.getByRole("listitem")).toContainText([
			new RegExp(ana.name),
			new RegExp(`${ben.name}.*you`),
		]);
		await expect(panel.getByText(/Incomplete team/)).toHaveCount(0);
	});

	await test.step("a full team turns a third student away", async () => {
		await logInAs(page, cai);
		await page.goto(url);
		await panel.getByRole("textbox", { name: "Team code" }).fill(code);
		await panel.getByRole("button", { name: "Join team" }).click();
		await expect(page.getByText("The team is full.")).toBeVisible();
		await expect(panel.getByRole("heading", { name: /^Team / })).toHaveCount(0);
	});

	const team = await prisma.team.findFirstOrThrow({
		where: { name: "Compilers" },
	});

	await test.step("after the first push the page shows the delivery, the history and the missing file", async () => {
		const sha = await deliver(team, { "main.py": "print(1)\n" }, "Add parser", {
			by: ana,
		});
		await logInAs(page, ana);
		await page.goto(url);

		const delivered = page.getByRole("region", { name: "Delivered on time" });
		await expect(delivered).toContainText(shortSha(sha));
		await expect(delivered).toContainText("Add parser");
		await expect(delivered).toContainText(ana.name);
		await expect(delivered).toContainText("New pushes");
		await expect(page.getByRole("heading", { name: "First push" })).toHaveCount(
			0,
		);

		const history = page.getByRole("region", { name: "Push history" });
		await expect(history.getByRole("listitem")).toHaveCount(1);
		await expect(history).toContainText(shortSha(sha));

		const missing = page
			.getByRole("alert")
			.filter({ hasText: "Required files missing from main" });
		await expect(missing.getByRole("listitem")).toHaveText(["README.md"]);

		await page.goto(`${world.href}/assignments`);
		await expect(
			page.getByRole("listitem").filter({ hasText: "Calculator" }),
		).toContainText("Delivered on time");
	});

	await test.step("a second push by a teammate supplies the file and tops the history", async () => {
		const sha = await deliver(team, { "README.md": "# Hi\n" }, "Add README", {
			by: ben,
		});
		await page.goto(url);

		await expect(
			page
				.getByRole("alert")
				.filter({ hasText: "Required files missing from main" }),
		).toHaveCount(0);
		const history = page.getByRole("region", { name: "Push history" });
		await expect(history.getByRole("listitem")).toHaveCount(2);
		await expect(history.getByRole("listitem").first()).toContainText(
			"Add README",
		);
		await expect(history.getByRole("listitem").first()).toContainText(ben.name);
		await expect(
			page.getByRole("region", { name: "Delivered on time" }),
		).toContainText(shortSha(sha));
	});

	await test.step("a new clone URL replaces the old one", async () => {
		const before = await tokenOf(team, ana.username);
		const clone = page.getByRole("region", { name: "Clone the repository" });
		await expect(clone).toContainText(`/git/${before}/`);

		await page.getByRole("button", { name: "Generate new clone URL" }).click();
		await expect.poll(() => tokenOf(team, ana.username)).not.toBe(before);
		const after = await tokenOf(team, ana.username);
		await expect(clone).toContainText(`/git/${after}/`);
		await expect(clone).not.toContainText(`${before}`);
	});

	await test.step("a temporary clone URL for a shared computer comes and goes", async () => {
		const permanent = await tokenOf(team, ana.username);
		const clone = page.getByRole("region", { name: "Clone the repository" });
		const temporary = page.getByRole("region", { name: "Temporary clone URL" });
		const generate = page.getByRole("button", {
			name: "Generate temporary clone URL",
		});
		const revoke = page.getByRole("button", { name: "Revoke temporary URL" });
		await expect(temporary).toHaveCount(0);
		await expect(revoke).toHaveCount(0);
		await expect(panel.getByText(/shared computer.*2 hours/)).toBeVisible();

		await generate.click();
		await expect(temporary).toBeVisible();
		const first = await tempTokenOf(team, ana.username);
		expect(first).not.toBeNull();
		expect(first).not.toBe(permanent);
		await expect(temporary).toContainText(
			`git clone ${new URL(page.url()).origin}/git/${first}/sa-calc.git`,
		);
		await expect(temporary).toContainText("stops working on");
		await expect(temporary.getByRole("button", { name: "Copy" })).toBeVisible();
		await expect(clone).toContainText(`/git/${permanent}/`);
		expect(await tokenOf(team, ana.username)).toBe(permanent);

		await generate.click();
		await expect.poll(() => tempTokenOf(team, ana.username)).not.toBe(first);
		const second = await tempTokenOf(team, ana.username);
		await expect(temporary).toContainText(`/git/${second}/`);
		await expect(temporary).not.toContainText(`${first}`);

		await revoke.click();
		await expect(temporary).toHaveCount(0);
		await expect(revoke).toHaveCount(0);
		expect(await tempTokenOf(team, ana.username)).toBeNull();
		await expect(clone).toContainText(`/git/${permanent}/`);
		await expect(generate).toBeVisible();
	});

	await test.step("a member may leave, but not the last one of a team with pushes", async () => {
		await logInAs(page, ben);
		await page.goto(url);
		await page.getByRole("button", { name: "Leave team" }).click();
		await expect(
			panel.getByRole("textbox", { name: "Team code" }),
		).toBeVisible();
		await expect(panel.getByRole("heading", { name: /^Team / })).toHaveCount(0);

		await logInAs(page, ana);
		await page.goto(url);
		await expect(
			page.getByRole("button", { name: "Leave team" }),
		).toBeDisabled();
		await expect(panel.getByText(/last member/)).toBeVisible();
	});
});

test("student: Do an individual assignment", async ({ page }) => {
	const world = await seedWorld("si", ["Iris Moreau"]);
	const iris = student(world, 1);
	await seedAssignment(world, "si-lab", {
		title: "Git lab",
		body: "# Git lab\n\nPractice the basics on your own.\n",
	});
	const url = `${world.href}/assignments/si-lab`;
	const panel = page.getByRole("region", { name: "Your repository" });
	await logInAs(page, iris);

	await test.step("the list says there is no repository yet", async () => {
		await page.goto(`${world.href}/assignments`);
		const item = page.getByRole("listitem").filter({ hasText: "Git lab" });
		await expect(item).toContainText("Individual");
		await expect(item).toContainText("No repository");
		await expect(item).not.toContainText("No team");
	});

	await test.step("the page offers a single button and never mentions teams", async () => {
		await page.goto(url);
		await expect(
			panel.getByRole("heading", { name: "Your repository" }),
		).toBeVisible();
		await expect(
			panel.getByRole("button", { name: "Create my repository" }),
		).toBeVisible();
		await expect(page.getByRole("region", { name: "Statement" })).toContainText(
			"Practice the basics on your own.",
		);
		await expect(page.getByRole("main")).not.toContainText(/team/i);
	});

	await test.step("creating the repository gives the clone URL and the first push", async () => {
		await panel.getByRole("button", { name: "Create my repository" }).click();

		const clone = page.getByRole("region", { name: "Clone the repository" });
		await expect(clone).toContainText("git clone");
		const row = await prisma.team.findFirstOrThrow();
		const token = await tokenOf(row, iris.username);
		await expect(clone).toContainText(`/git/${token}/si-lab.git`);
		await expect(
			panel.getByRole("heading", { name: "First push" }),
		).toBeVisible();
		await expect(page.getByRole("button", { name: "Leave team" })).toHaveCount(
			0,
		);
		await expect(page.getByRole("main")).not.toContainText(/team/i);
	});

	await test.step("after a push the page speaks of the student's own delivery", async () => {
		const row = await prisma.team.findFirstOrThrow();
		const sha = await deliver(row, { "ex01/LEIAME.md": "ok\n" }, "Exercise 1", {
			by: iris,
		});
		await page.goto(url);

		const delivered = page.getByRole("region", { name: "Delivered on time" });
		await expect(delivered).toContainText(shortSha(sha));
		await expect(delivered).toContainText("your delivery");
		await expect(delivered).toContainText(iris.name);
		await expect(page.getByRole("region", { name: "Deadlines" })).toContainText(
			"Your due date",
		);
		await expect(page.getByRole("main")).not.toContainText(/team/i);

		await page.goto(`${world.href}/assignments`);
		await expect(
			page.getByRole("listitem").filter({ hasText: "Git lab" }),
		).toContainText("Delivered on time");
	});
});

test("student: See where I stand after the deadline", async ({ page }) => {
	const world = await seedWorld("sd", ["Dora Lima"]);
	const dora = student(world, 1);
	const team = (slug: string) =>
		prisma.team.findFirstOrThrow({
			where: { assignment: { slug } },
		});

	// Everything that needs an open assignment happens first; the dates
	// move into the past afterwards, since the server's clock cannot.
	const both = await seedAssignment(world, "sd-both", { title: "Both" });
	const lateOnly = await seedAssignment(world, "sd-late", {
		title: "Late only",
	});
	const nothing = await seedAssignment(world, "sd-nothing", {
		title: "Nothing",
	});
	const extended = await seedAssignment(world, "sd-extended", {
		title: "Extended",
	});
	const closed = await seedAssignment(world, "sd-closed", { title: "Closed" });
	const locked = await seedAssignment(world, "sd-locked", {
		title: "Locked",
		teamMin: 2,
		teamMax: 3,
		teamsLockAt: hoursFromNow(1),
	});
	await seedAssignment(world, "sd-hidden", {
		title: "Secret",
		opensAt: daysFromNow(2),
	});
	for (const work of [both, lateOnly, nothing, extended, closed]) {
		await createTeamAs(work, dora, `dora-${work.slug}`);
	}
	const bothOnTime = await deliver(
		await team("sd-both"),
		{ "a.txt": "1\n" },
		"On time commit",
		{ by: dora, at: daysFromNow(-4) },
	);
	const bothLate = await deliver(
		await team("sd-both"),
		{ "b.txt": "2\n" },
		"Late commit",
		{ by: dora, at: hoursFromNow(-3) },
	);
	const lateSha = await deliver(
		await team("sd-late"),
		{ "a.txt": "1\n" },
		"Only late commit",
		{ by: dora, at: hoursFromNow(-3) },
	);
	await deliver(
		await team("sd-extended"),
		{ "a.txt": "1\n" },
		"Within the extension",
		{ by: dora, at: hoursFromNow(-5) },
	);
	await deliver(await team("sd-closed"), { "a.txt": "1\n" }, "Before closing", {
		by: dora,
		at: daysFromNow(-13),
	});
	await extendTeam(world, await team("sd-extended"), daysFromNow(2));
	await changeWork(world, both, {
		dueAt: daysFromNow(-2),
		closesAt: daysFromNow(5),
	});
	await changeWork(world, lateOnly, {
		dueAt: daysFromNow(-2),
		closesAt: daysFromNow(5),
	});
	await changeWork(world, nothing, {
		dueAt: daysFromNow(-2),
		closesAt: daysFromNow(5),
	});
	await changeWork(world, extended, {
		dueAt: daysFromNow(-1),
		closesAt: daysFromNow(5),
	});
	await changeWork(world, closed, {
		dueAt: daysFromNow(-12),
		closesAt: daysFromNow(-5),
	});
	await changeWork(world, locked, {
		dueAt: daysFromNow(3),
		teamsLockAt: hoursFromNow(-24),
	});
	await logInAs(page, dora);
	const at = (slug: string) => `${world.href}/assignments/${slug}`;

	await test.step("the list shows each state and leaves out what is not open", async () => {
		await page.goto(`${world.href}/assignments`);
		const status = (title: string) =>
			page.getByRole("listitem").filter({ hasText: title });

		await expect(status("Both")).toContainText("Late delivery");
		await expect(status("Late only")).toContainText("No delivery on time");
		await expect(status("Nothing")).toContainText("No delivery on time");
		await expect(status("Extended")).toContainText("Delivered on time");
		await expect(status("Closed")).toContainText("Closed");
		await expect(status("Locked")).toContainText("No team");
		await expect(status("Secret")).toHaveCount(0);
	});

	await test.step("a delivery made in time stays pinned, with the late one beside it", async () => {
		await page.goto(at("sd-both"));

		await expect(
			page.getByRole("alert").filter({ hasText: "The due date has passed" }),
		).toBeVisible();
		const onTime = page.getByRole("region", { name: "Delivered on time" });
		await expect(onTime).toContainText(shortSha(bothOnTime));
		await expect(onTime).toContainText("On time commit");
		await expect(onTime).toContainText("Pinned");
		const late = page.getByRole("region", { name: "Late delivery" });
		await expect(late).toContainText(shortSha(bothLate));
		await expect(late).toContainText("Late commit");

		const history = page.getByRole("region", { name: "Push history" });
		await expect(history.getByRole("listitem").first()).toContainText("Late");
	});

	await test.step("with only late pushes nothing was delivered on time", async () => {
		await page.goto(at("sd-late"));

		const none = page.getByRole("region", { name: "No delivery on time" });
		await expect(none).toBeVisible();
		await expect(
			page.getByRole("region", { name: "Delivered on time" }),
		).toHaveCount(0);
		await expect(
			page.getByRole("region", { name: "Late delivery" }),
		).toContainText(shortSha(lateSha));
	});

	await test.step("a repository that never received a push has no delivery at all", async () => {
		await page.goto(at("sd-nothing"));

		await expect(
			page.getByRole("region", { name: "No delivery on time" }),
		).toBeVisible();
		await expect(
			page.getByRole("region", { name: "Late delivery" }),
		).toHaveCount(0);
	});

	await test.step("an extended deadline is marked, with the original beside it", async () => {
		await page.goto(at("sd-extended"));

		await expect(
			page.getByRole("region", { name: "Delivered on time" }),
		).toContainText("Within the extension");
		const deadlines = page.getByRole("region", { name: "Deadlines" });
		await expect(deadlines).toContainText("Your due date");
		await expect(deadlines).toContainText("extended");
		await expect(deadlines).toContainText("original");
		await expect(
			page.getByRole("alert").filter({ hasText: "The due date has passed" }),
		).toHaveCount(0);
	});

	await test.step("once pushes close the page says so and the clone stays available", async () => {
		await page.goto(at("sd-closed"));

		await expect(
			page.getByRole("alert").filter({ hasText: "Pushes closed on" }),
		).toContainText("Cloning is still available");
		const clone = page.getByRole("region", { name: "Clone the repository" });
		await expect(clone).toContainText("git clone");
		await expect(
			page.getByRole("region", { name: "Delivered on time" }),
		).toContainText("Before closing");
		await expect(page.getByRole("heading", { name: "First push" })).toHaveCount(
			0,
		);
	});

	await test.step("without a team after teams lock, the student is sent to the instructor", async () => {
		await page.goto(at("sd-locked"));

		const panel = page.getByRole("region", { name: "Your team" });
		await expect(panel.getByRole("alert")).toContainText("Ask your instructor");
		await expect(
			panel.getByRole("button", { name: "Create team" }),
		).toHaveCount(0);
		await expect(panel.getByRole("button", { name: "Join team" })).toHaveCount(
			0,
		);
	});

	await test.step("an assignment that has not opened is not found", async () => {
		const response = await page.goto(at("sd-hidden"));

		expect(response?.status()).toBe(404);
	});
});

test("student: Follow the checkpoints of an assignment", async ({ page }) => {
	const world = await seedWorld("sk", ["Kim Okafor"]);
	const kim = student(world, 1);
	const work = await seedAssignment(world, "sk-compiler", {
		title: "Compiler",
		checkpoints: [
			{ slug: "lexer", title: "Lexer done", at: daysFromNow(-6) },
			{ slug: "parser", title: "Parser done", at: daysFromNow(-2) },
			{ slug: "typer", title: "Typer done", at: daysFromNow(-1) },
			{ slug: "codegen", title: "Codegen done", at: daysFromNow(2) },
		],
	});
	const team = await createTeamAs(work, kim, "kim");
	const early = await deliver(team, { "a.txt": "1\n" }, "Parser works", {
		by: kim,
		at: daysFromNow(-4),
	});
	const recent = await deliver(team, { "b.txt": "2\n" }, "Start codegen", {
		by: kim,
		at: hoursFromNow(-1),
	});
	await logInAs(page, kim);
	await page.goto(`${world.href}/assignments/sk-compiler`);

	await test.step("the deadlines name each checkpoint before the due date", async () => {
		const deadlines = page.getByRole("region", { name: "Deadlines" });

		for (const title of ["Lexer", "Parser", "Typer", "Codegen"]) {
			await expect(deadlines).toContainText(`${title} done`);
		}
		await expect(deadlines.getByText("checkpoint")).toHaveCount(4);
	});

	const checkpoint = (title: string) =>
		page
			.getByRole("region", { name: "Checkpoints" })
			.getByRole("listitem")
			.filter({ hasText: title });

	await test.step("a checkpoint still ahead says it has not been reached", async () => {
		await expect(checkpoint("Codegen done")).toContainText("Not reached yet");
		await expect(checkpoint("Codegen done")).not.toContainText(
			shortSha(recent),
		);
	});

	await test.step("a checkpoint that has passed shows the commit main had at that instant", async () => {
		await expect(checkpoint("Parser done")).toContainText(shortSha(early));
		await expect(checkpoint("Parser done")).toContainText(kim.name);
		await expect(checkpoint("Typer done")).toContainText(shortSha(early));
	});

	await test.step("a checkpoint that passed before the first push says nothing was pushed", async () => {
		await expect(checkpoint("Lexer done")).toContainText("Passed with no push");
	});

	await test.step("the push that counts carries the titles of its checkpoints in the history", async () => {
		const pushes = page
			.getByRole("region", { name: "Push history" })
			.getByRole("listitem");
		const counted = pushes.filter({ hasText: shortSha(early) });
		const latest = pushes.filter({ hasText: shortSha(recent) });

		await expect(counted).toContainText("Parser done");
		await expect(counted).toContainText("Typer done");
		await expect(latest).not.toContainText("done");
	});
});
