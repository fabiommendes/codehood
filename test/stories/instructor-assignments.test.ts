import type { Locator, Page } from "@playwright/test";
import type { UserActor } from "@/auth/actor";
import { prisma } from "@/db/client";
import { expect, test } from "../fixtures";
import {
	changeWork,
	createStaffTeam,
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
} from "./assignment-support";
import { logInAs, resetDatabase } from "./helpers";

/*
 * UI contract assumed by these stories (en build).
 * The student's side of the same page is described in
 * `student-assignments.test.ts`.
 *
 * List (`<course>/assignments`): the instructor sees every assignment,
 * including one that has not opened, as a list item with a link named after
 * its title.
 *
 * Page (`<course>/assignments/<slug>`) for whoever manages the course
 *   - Heading with the title and a link "Assignments" back to the list.
 *   - Region "Summary" with a term/definition pair per count. Team
 *     assignment: "Teams", "Students without a team", "On-time delivery",
 *     "Late only". Individual: "Repositories", "Without repository",
 *     "On-time delivery", "Late only". The first definition of each pair is
 *     the number alone.
 *   - Region "Command line" with the text `codehood assignment status <slug>`
 *     and `codehood assignment clone <slug>`.
 *   - Team assignment: region "Teams" holding a table named "Assignment teams"
 *     with a searchbox "Search team or student", a button "Create team", and
 *     one row per team with the team name, one list item per member (full
 *     name and a button "Remove <name> from team <team>"), the size, the
 *     deliveries and the actions. The size is the bare number, plus a text for
 *     screen readers when the team is outside the range: "Exception: above the
 *     maximum (...)", "Exception: below the minimum (...)" or "No members. ...";
 *     the cell of a team without members reads "nobody". The deliveries read
 *     "on time" and "late" each with the short sha, or "no delivery". An
 *     extended team shows "extended until <date>". Actions: a button "Add
 *     student to team <team>" and a button "More actions for team <team>" that
 *     opens a menu of buttons "Rename" and "Delete team".
 *   - Region "Students without a team" with the heading "Students without a
 *     team (<n>)", a table named "Students without a team" with a searchbox
 *     "Search student" and a button "Add to a team" per row.
 *   - Individual assignment: region "Students" with a table named "Students
 *     and their repositories" (searchbox "Search student"), one row per
 *     enrolled student with the full name, the deliveries as above, "no
 *     repository" for who has none and "extended until <date>" for an
 *     extended deadline. No "Create team", no "Students without a team", no
 *     member or team actions.
 *   - Region "Deadlines" with the labels "Opens" (only when set), "Due date"
 *     and "Pushes until" (only when set).
 *   - Dialogs (role dialog, named by their title), each with a button
 *     "Cancel":
 *       - "Create team": textbox "Team name", button "Create team".
 *       - "Add student to team <team>": searchbox "Search student"; one list
 *         item per match with the name, "no team" or "in team <other>", and
 *         the button "Add" or "Move here".
 *       - "Move <student> to <team>?": text "<student> leaves the team <other>
 *         and joins <team>." and the button "Move student".
 *       - "Rename team <team>": textbox "New name", button "Rename".
 *       - "Delete team <team>?": text "The team's repository and the <n>
 *         pushes will be lost. This cannot be undone." and the button "Delete
 *         team and <n> pushes".
 *       - "Add <student> to a team": searchbox "Search team"; one list item
 *         per team with its name and a button "Add".
 *     A refused action keeps its dialog open and shows the error in it.
 */

test.beforeEach(resetDatabase);
test.afterAll(stopDelivering);

/// The cell of the summary that holds the count named `label`.
function count(summary: Locator, label: string): Locator {
	return (
		summary
			.locator("div")
			// A term has no accessible name, so it is matched by its text.
			.filter({
				has: summary
					.page()
					.getByRole("term")
					.filter({ hasText: new RegExp(`^${label}$`) }),
			})
			.getByRole("definition")
			.first()
	);
}

/// A row of the table named `name`, found by the text it holds.
function rowOf(page: Page, name: string, text: string): Locator {
	return page
		.getByRole("table", { name })
		.getByRole("row")
		.filter({ hasText: text });
}

test("instructor: Compose the teams of an assignment", async ({ page }) => {
	const world = await seedWorld("ic", [
		"Ada Lovelace",
		"Alan Turing",
		"Grace Hopper",
		"Linus Torvalds",
		"Barbara Liskov",
		"Donald Knuth",
		"Edsger Dijkstra",
		"Margaret Hamilton",
		"Dennis Ritchie",
	]);
	const [ada, alan, grace, linus, barbara, donald, edsger, margaret, dennis] = [
		1, 2, 3, 4, 5, 6, 7, 8, 9,
	].map((n) => student(world, n)) as [
		UserActor,
		UserActor,
		UserActor,
		UserActor,
		UserActor,
		UserActor,
		UserActor,
		UserActor,
		UserActor,
	];
	const work = await seedAssignment(world, "ic-project", {
		title: "Project",
		teamMin: 2,
		teamMax: 3,
	});
	const alpha = await createStaffTeam(world, work, "Alpha", [ada, alan]);
	const beta = await createStaffTeam(world, work, "Beta", [grace]);
	await createStaffTeam(world, work, "Gamma", [linus, barbara, donald, edsger]);
	await deliver(alpha, { "a.txt": "1\n" }, "First", { by: ada });
	const alphaSha = await deliver(alpha, { "b.txt": "2\n" }, "Second", {
		by: alan,
	});
	await extendTeam(world, beta, daysFromNow(10));
	await logInAs(page, world.instructor);

	const teams = page.getByRole("region", { name: "Teams", exact: true });
	const unassigned = page.getByRole("region", {
		name: "Students without a team",
	});
	const team = (name: string) => rowOf(page, "Assignment teams", name);
	const dialog = (name: string) => page.getByRole("dialog", { name });

	await test.step("the summary counts the teams and the students left out, with the CLI commands", async () => {
		await page.goto(`${world.href}/assignments/ic-project`);

		const summary = page.getByRole("region", { name: "Summary" });
		await expect(count(summary, "Teams")).toHaveText("3");
		await expect(count(summary, "Students without a team")).toHaveText("2");
		await expect(count(summary, "On-time delivery")).toHaveText("1");
		await expect(count(summary, "Late only")).toHaveText("0");

		const commands = page.getByRole("region", { name: "Command line" });
		await expect(commands).toContainText(
			"codehood assignment status ic-project",
		);
		await expect(commands).toContainText(
			"codehood assignment clone ic-project",
		);
	});

	await test.step("the table shows members, size exceptions, extensions and deliveries", async () => {
		await expect(team("Alpha")).toContainText(ada.name);
		await expect(team("Alpha")).toContainText(alan.name);
		await expect(team("Alpha")).toContainText(shortSha(alphaSha));
		await expect(team("Alpha")).toContainText("on time");
		await expect(team("Alpha")).not.toContainText("Exception");

		await expect(team("Beta")).toContainText(grace.name);
		await expect(team("Beta")).toContainText("below the minimum");
		await expect(team("Beta")).toContainText("extended until");
		await expect(team("Beta")).toContainText("no delivery");

		await expect(team("Gamma")).toContainText("above the maximum");
		for (const member of [linus, barbara, donald, edsger]) {
			await expect(team("Gamma")).toContainText(member.name);
		}

		await expect(
			unassigned.getByRole("heading", { name: "Students without a team (2)" }),
		).toBeVisible();
		await expect(
			rowOf(page, "Students without a team", margaret.name),
		).toBeVisible();
		await expect(
			rowOf(page, "Students without a team", dennis.name),
		).toBeVisible();
	});

	await test.step("a new team starts empty", async () => {
		await teams
			.getByRole("button", { name: "Create team", exact: true })
			.click();
		await dialog("Create team")
			.getByRole("textbox", { name: "Team name" })
			.fill("Delta");
		await dialog("Create team")
			.getByRole("button", { name: "Create team", exact: true })
			.click();

		await expect(dialog("Create team")).toBeHidden();
		await expect(team("Delta")).toContainText("nobody");
		await expect(team("Delta")).toContainText("No members");
	});

	await test.step("a student without a team is added to it", async () => {
		await page
			.getByRole("button", { name: "Add student to team Delta" })
			.click();
		const add = dialog("Add student to team Delta");
		await add
			.getByRole("searchbox", { name: "Search student" })
			.fill("Margaret");
		const hit = add.getByRole("listitem").filter({ hasText: margaret.name });
		await expect(hit).toContainText("no team");
		await hit.getByRole("button", { name: "Add", exact: true }).click();

		await expect(add).toBeHidden();
		await expect(team("Delta")).toContainText(margaret.name);
		await expect(
			unassigned.getByRole("heading", { name: "Students without a team (1)" }),
		).toBeVisible();
	});

	await test.step("moving a student out of another team asks for confirmation naming it", async () => {
		await page
			.getByRole("button", { name: "Add student to team Delta" })
			.click();
		const add = dialog("Add student to team Delta");
		await add.getByRole("searchbox", { name: "Search student" }).fill("Grace");
		const hit = add.getByRole("listitem").filter({ hasText: grace.name });
		await expect(hit).toContainText("in team Beta");
		await hit.getByRole("button", { name: "Move here" }).click();

		const confirm = dialog(`Move ${grace.name} to Delta?`);
		await expect(confirm).toContainText(
			`${grace.name} leaves the team Beta and joins Delta.`,
		);
		await confirm.getByRole("button", { name: "Move student" }).click();

		await expect(confirm).toBeHidden();
		await expect(team("Delta")).toContainText(grace.name);
		await expect(team("Beta")).not.toContainText(grace.name);
		await expect(team("Beta")).toContainText("No members");
	});

	await test.step("taking a member out leaves the team and ends its size exception", async () => {
		await team("Gamma")
			.getByRole("button", { name: `Remove ${edsger.name} from team Gamma` })
			.click();

		await expect(team("Gamma")).not.toContainText(edsger.name);
		await expect(team("Gamma")).not.toContainText("Exception");
		await expect(
			unassigned.getByRole("heading", { name: "Students without a team (2)" }),
		).toBeVisible();
	});

	await test.step("a name another team has is refused when renaming", async () => {
		await page
			.getByRole("button", { name: "More actions for team Gamma" })
			.click();
		await page.getByRole("button", { name: "Rename", exact: true }).click();
		const rename = dialog("Rename team Gamma");
		await rename.getByRole("textbox", { name: "New name" }).fill("Alpha");
		await rename.getByRole("button", { name: "Rename", exact: true }).click();
		await expect(
			rename.getByText("Another team of this assignment has this name."),
		).toBeVisible();

		await rename.getByRole("textbox", { name: "New name" }).fill("Omega");
		await rename.getByRole("button", { name: "Rename", exact: true }).click();

		await expect(rename).toBeHidden();
		await expect(team("Omega")).toContainText(linus.name);
		await expect(team("Gamma")).toHaveCount(0);
	});

	await test.step("a student on the list of those without a team is put in one", async () => {
		await rowOf(page, "Students without a team", dennis.name)
			.getByRole("button", { name: "Add to a team" })
			.click();
		const assign = dialog(`Add ${dennis.name} to a team`);
		await assign.getByRole("searchbox", { name: "Search team" }).fill("Beta");
		await assign
			.getByRole("listitem")
			.filter({ hasText: "Beta" })
			.getByRole("button", { name: "Add", exact: true })
			.click();

		await expect(assign).toBeHidden();
		await expect(team("Beta")).toContainText(dennis.name);
		await expect(
			unassigned.getByRole("heading", { name: "Students without a team (1)" }),
		).toBeVisible();
	});

	await test.step("deleting a team says how many pushes are lost", async () => {
		await page
			.getByRole("button", { name: "More actions for team Alpha" })
			.click();
		await page
			.getByRole("button", { name: "Delete team", exact: true })
			.click();
		const confirm = dialog("Delete team Alpha?");
		await expect(confirm).toContainText("2 pushes");
		await confirm
			.getByRole("button", { name: "Delete team and 2 pushes" })
			.click();

		await expect(confirm).toBeHidden();
		await expect(team("Alpha")).toHaveCount(0);
		await expect(
			unassigned.getByRole("heading", { name: "Students without a team (3)" }),
		).toBeVisible();
		for (const member of [ada, alan]) {
			await expect(
				rowOf(page, "Students without a team", member.name),
			).toBeVisible();
		}
	});

	await test.step("after a reload the summary matches the new composition", async () => {
		await page.reload();

		const summary = page.getByRole("region", { name: "Summary" });
		await expect(count(summary, "Teams")).toHaveText("3");
		await expect(count(summary, "Students without a team")).toHaveText("3");
		await expect(count(summary, "On-time delivery")).toHaveText("0");
		expect(await prisma.team.count({ where: { name: "Alpha" } })).toBe(0);
	});
});

test("instructor: Follow an individual assignment", async ({ page }) => {
	const world = await seedWorld("ii", [
		"Bea Santos",
		"Cal Reyes",
		"Dee Park",
		"Eli Novak",
	]);
	const [bea, cal, dee, eli] = [1, 2, 3, 4].map((n) => student(world, n)) as [
		UserActor,
		UserActor,
		UserActor,
		UserActor,
	];
	const work = await seedAssignment(world, "ii-lab", { title: "Git lab" });
	await seedAssignment(world, "ii-secret", {
		title: "Secret",
		opensAt: daysFromNow(3),
		dueAt: daysFromNow(10),
	});
	const beaTeam = await createTeamAs(work, bea, "x");
	const calTeam = await createTeamAs(work, cal, "x");
	const deeTeam = await createTeamAs(work, dee, "x");
	const onTime = await deliver(beaTeam, { "a.txt": "1\n" }, "Bea on time", {
		by: bea,
		at: daysFromNow(-4),
	});
	const late = await deliver(calTeam, { "a.txt": "1\n" }, "Cal late", {
		by: cal,
		at: hoursFromNow(-3),
	});
	await extendTeam(world, deeTeam, daysFromNow(3));
	await changeWork(world, work, {
		dueAt: daysFromNow(-2),
		closesAt: daysFromNow(5),
	});
	await logInAs(page, world.instructor);

	const students = page.getByRole("region", { name: "Students", exact: true });
	const row = (name: string) =>
		rowOf(page, "Students and their repositories", name);

	await test.step("the table lists students with their own deliveries, and who has no repository", async () => {
		await page.goto(`${world.href}/assignments/ii-lab`);

		await expect(row(bea.name)).toContainText(shortSha(onTime));
		await expect(row(bea.name)).toContainText("on time");
		await expect(row(cal.name)).toContainText(shortSha(late));
		await expect(row(cal.name)).toContainText("late");
		await expect(row(cal.name)).not.toContainText("on time");
		await expect(row(dee.name)).toContainText("extended until");
		await expect(row(eli.name)).toContainText("no repository");
		await expect(row(bea.name)).not.toContainText("no repository");
	});

	await test.step("the summary counts repositories, not teams, and the CLI commands are listed", async () => {
		const summary = page.getByRole("region", { name: "Summary" });
		await expect(count(summary, "Repositories")).toHaveText("3");
		await expect(count(summary, "Without repository")).toHaveText("1");
		await expect(count(summary, "On-time delivery")).toHaveText("1");
		await expect(count(summary, "Late only")).toHaveText("1");
		await expect(
			page.getByRole("region", { name: "Command line" }),
		).toContainText("codehood assignment status ii-lab");
	});

	await test.step("there is nothing to compose", async () => {
		await expect(page.getByRole("button", { name: "Create team" })).toHaveCount(
			0,
		);
		await expect(
			page.getByRole("button", { name: /Add student to team/ }),
		).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: /^Remove .* from team/ }),
		).toHaveCount(0);
		await expect(
			page.getByRole("region", { name: "Students without a team" }),
		).toHaveCount(0);
	});

	await test.step("the search narrows the table to one student", async () => {
		await students
			.getByRole("searchbox", { name: "Search student" })
			.fill("Cal");

		await expect(row(cal.name)).toBeVisible();
		await expect(row(bea.name)).toHaveCount(0);
	});

	await test.step("an assignment that has not opened is visible to the instructor and hidden from students", async () => {
		await page.goto(`${world.href}/assignments`);
		await expect(
			page.getByRole("listitem").filter({ hasText: "Secret" }),
		).toBeVisible();
		await page.getByRole("link", { name: /Secret/ }).click();

		await expect(page).toHaveURL(`${world.href}/assignments/ii-secret`);
		await expect(page.getByRole("heading", { name: "Secret" })).toBeVisible();
		await expect(page.getByRole("region", { name: "Deadlines" })).toContainText(
			"Opens",
		);

		await logInAs(page, bea);
		await page.goto(`${world.href}/assignments`);
		await expect(
			page.getByRole("listitem").filter({ hasText: "Git lab" }),
		).toBeVisible();
		await expect(
			page.getByRole("listitem").filter({ hasText: "Secret" }),
		).toHaveCount(0);
		const response = await page.goto(`${world.href}/assignments/ii-secret`);
		expect(response?.status()).toBe(404);
	});
});
