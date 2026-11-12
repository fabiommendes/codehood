import type { PlaywrightWorkerArgs } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { courseHref } from "@/urls";
import {
	makeWorld,
	snapshotRows,
	storedField,
	type World,
} from "./answer-edit-service-support";
import { expect, type Page, test } from "./fixtures";
import { parseDevalue } from "./helpers/devalue-lite";
import { logInAs, resetDatabase } from "./stories/helpers";

// The student's page against the real history actions, with the development
// switch on (spec `historico-de-edicao-no-servidor`, T6): R25 and R26 (the
// transport and the final flush), R27 (local identity), R28 (the local copy is
// erased), R29 and R31 (the exam switch reaches an open page).
//
// The history is sent every 55 to 65 s, so the tests do not wait for the
// cadence: they hide the page, which is one of the moments the page flushes
// at (R26), and poll the server tables.

test.beforeEach(resetDatabase);

const SWITCH_KEY = "codehood.answerHistory";
const SECOND = 1000;
const FINISH_ACTION = "**/_actions/exam.finish**";
const HISTORY_ACTIONS = /_actions\/answerHistory\.(inspect|send)/;
const POLL = { timeout: 20 * SECOND, intervals: [250, 500, 1000] };

function segments(world: World) {
	return {
		discipline: world.course.discipline.slug,
		course: `${world.course.instructor.username}_${world.course.edition.slug}`,
		exam: world.exam.slug,
	};
}

function examPath(world: World): string {
	return `${courseHref({
		discipline: world.course.discipline.slug,
		instructor: world.instructor.username,
		edition: world.course.edition.slug,
	})}/exams/${world.exam.slug}`;
}

/// The student's page, signed in, with the development switch on unless told otherwise.
async function openStudent(
	page: Page,
	world: World,
	options: { switchOn?: boolean } = {},
) {
	await logInAs(page, world.student);
	if (options.switchOn !== false) {
		await page.addInitScript(
			(key) => localStorage.setItem(key, "on"),
			SWITCH_KEY,
		);
	}
	await page.goto(examPath(world));
}

const answerBox = (page: Page) => page.getByRole("textbox").first();

function watchErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	return errors;
}

/// Every request the page makes to the history actions, in order.
function watchHistoryRequests(page: Page) {
	const requests: { endpoint: "inspect" | "send" }[] = [];
	page.on("request", (request) => {
		const match = HISTORY_ACTIONS.exec(request.url());
		if (match) requests.push({ endpoint: match[1] as "inspect" | "send" });
	});
	return {
		all: () => requests.length,
		sends: () => requests.filter((it) => it.endpoint === "send").length,
	};
}

/// Hides the page and shows it again: the page flushes its history when it is hidden.
async function flushHistory(page: Page): Promise<void> {
	await page.evaluate(() => {
		const state = (value: DocumentVisibilityState) =>
			Object.defineProperty(document, "visibilityState", {
				configurable: true,
				get: () => value,
			});
		state("hidden");
		document.dispatchEvent(new Event("visibilitychange"));
		state("visible");
	});
}

/// The text the server holds for the first essay, after asking the page to flush.
async function deliveredText(page: Page, world: World): Promise<string | null> {
	await flushHistory(page);
	return (await storedField(world))?.text ?? null;
}

/// The latest answer the server saved for the first essay.
async function savedAnswer(world: World): Promise<unknown> {
	const rows = await prisma.submission.findMany({
		where: { responseId: world.attempt.id },
		orderBy: { id: "asc" },
	});
	return rows.at(-1)?.payload ?? null;
}

async function finished(world: World): Promise<boolean> {
	const row = await prisma.response.findUniqueOrThrow({
		where: { id: world.attempt.id },
	});
	return row.acceptingSubmissions === false;
}

/// Runs the submit dialog and resolves when the server has seen `finish`.
async function submit(page: Page): Promise<void> {
	await page
		.getByRole("button", { name: /^Submit/ })
		.first()
		.click();
	const response = page.waitForResponse(FINISH_ACTION);
	await page
		.getByRole("dialog")
		.getByRole("button", { name: /submit|confirm/i })
		.click();
	expect((await response).ok()).toBe(true);
}

/// Submits, then waits for the page to reload into its finished state.
async function submitAndReload(page: Page): Promise<void> {
	await submit(page);
	await expect(page.getByRole("textbox")).toHaveCount(0, {
		timeout: 10 * SECOND,
	});
	await page.waitForLoadState("load");
}

/// The instructor flips the exam switch through the action, as the toggle does.
async function setSwitch(
	playwright: PlaywrightWorkerArgs["playwright"],
	baseURL: string | undefined,
	world: World,
	enabled: boolean,
): Promise<void> {
	const { token } = await db.session.create(
		{ username: world.instructor.username },
		FULL_ACCESS,
	);
	const instructor = await playwright.request.newContext({
		baseURL,
		extraHTTPHeaders: { cookie: `session=${token}` },
	});
	const response = await instructor.post("/_actions/exam.setAnswerHistory", {
		data: { ...segments(world), enabled },
	});
	expect(response.status()).toBe(200);
	await instructor.dispose();
}

/// Lets the page run the work a response just queued, which a network event does not wait for.
async function yieldToPage(page: Page): Promise<void> {
	for (let turn = 0; turn < 3; turn++)
		await page.evaluate(() => new Promise<void>((done) => setTimeout(done, 0)));
}

/// The switch an `exam.answer` response reports.
function answerHistoryOf(body: string): unknown {
	return (parseDevalue(body) as { answerHistory?: unknown }).answerHistory;
}

/// The records of the local history, one `[key, text]` per field.
async function localRecords(page: Page): Promise<[string, string][]> {
	return await page.evaluate(async () => {
		const names = (await indexedDB.databases())
			.map((entry) => entry.name ?? "")
			.filter((name) => name.includes("codehood-answer-edits"));
		const found: [string, string][] = [];
		for (const name of names) {
			const database = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open(name);
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			const store = database.transaction("records").objectStore("records");
			const [keys, values] = await Promise.all([
				new Promise<IDBValidKey[]>((resolve, reject) => {
					const request = store.getAllKeys();
					request.onsuccess = () => resolve(request.result);
					request.onerror = () => reject(request.error);
				}),
				new Promise<unknown[]>((resolve, reject) => {
					const request = store.getAll();
					request.onsuccess = () => resolve(request.result);
					request.onerror = () => reject(request.error);
				}),
			]);
			database.close();
			keys.forEach((key, index) => {
				const value = values[index];
				if (value && typeof value === "object" && "text" in value)
					found.push([String(key), String(value.text)]);
			});
		}
		return found;
	});
}

//
// R25, R27: what the student types reaches the tables
//

test("what the student types reaches the server tables, and the local record is keyed by the attempt", async ({
	page,
}) => {
	const world = await makeWorld({ type: "EXAM" });
	const errors = watchErrors(page);
	await openStudent(page, world);

	await answerBox(page).pressSequentially("first words, then more", {
		delay: 20,
	});

	await expect
		.poll(() => deliveredText(page, world), POLL)
		.toBe("first words, then more");
	const stored = await storedField(world);
	expect(stored?.revision).toBeGreaterThan(0);
	expect(stored?.batches.length).toBeGreaterThan(0);
	expect(stored?.gaps).toEqual([]);
	expect(stored?.incompleteAt).toBeNull();
	expect(stored?.history.incompleteAt).toBeNull();
	expect(stored?.history.editCount).toBeGreaterThan(0);
	/// The history follows the answer: the same text the answer channel saved.
	await expect.poll(() => savedAnswer(world)).toBe("first words, then more");
	/// R27: the key is the attempt's public id, which `discipline/course/exam` is not.
	await expect
		.poll(async () => (await localRecords(page)).map(([key]) => key))
		.toContain(
			JSON.stringify([world.attempt.publicId, world.slugs.text, "answer"]),
		);
	expect(errors).toEqual([]);
});

//
// R26: the final flush waits for the baseline to be checked
//

test("the final flush waits for a reconciliation in progress and still delivers the last words", async ({
	page,
}) => {
	const world = await makeWorld({ type: "EXAM" });
	const errors = watchErrors(page);
	let inspecting = false;
	let release: () => void = () => {};
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route(/_actions\/answerHistory\.inspect/, async (route) => {
		inspecting = true;
		await held;
		await route.continue();
	});
	await openStudent(page, world);
	await answerBox(page).pressSequentially("final words", { delay: 20 });
	/// The page is checking its baseline against the server, and the server is slow.
	await expect.poll(() => inspecting, POLL).toBe(true);

	await page
		.getByRole("button", { name: /^Submit/ })
		.first()
		.click();
	const response = page.waitForResponse(FINISH_ACTION);
	await page
		.getByRole("dialog")
		.getByRole("button", { name: /submit|confirm/i })
		.click();
	expect((await response).ok()).toBe(true);
	release();

	/// No other flush is triggered: only the final one, which had to wait.
	await expect
		.poll(async () => (await storedField(world))?.text ?? null, POLL)
		.toBe("final words");
	await expect.poll(() => finished(world)).toBe(true);
	expect(errors).toEqual([]);
});

//
// R28: the local copy is erased
//

test("the local records are gone once the attempt is delivered, before the page reloads", async ({
	page,
}) => {
	const world = await makeWorld({ type: "EXAM" });
	const errors = watchErrors(page);
	await openStudent(page, world);
	await answerBox(page).pressSequentially("to be erased", { delay: 20 });
	await expect
		.poll(async () => (await localRecords(page)).map(([, text]) => text), POLL)
		.toContain("to be erased");
	/// Hold the reload that follows `finish`, so only the erasure the page asks for can empty the store.
	let reloadRequested = false;
	let release: () => void = () => {};
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route(`**${examPath(world)}`, async (route) => {
		if (route.request().isNavigationRequest()) {
			reloadRequested = true;
			await held;
		}
		await route.continue();
	});

	await submit(page);
	await expect.poll(() => reloadRequested, POLL).toBe(true);

	await expect.poll(() => localRecords(page), POLL).toEqual([]);
	release();
	await expect(page.getByRole("textbox")).toHaveCount(0, {
		timeout: 10 * SECOND,
	});
	await page.waitForLoadState("load");
	expect(await localRecords(page)).toEqual([]);
	expect(errors).toEqual([]);
});

test("opening the page of an attempt that is not in progress removes its local records in the background", async ({
	page,
}) => {
	const world = await makeWorld({ type: "EXAM" });
	const errors = watchErrors(page);
	await openStudent(page, world);
	await answerBox(page).pressSequentially("left behind", { delay: 20 });
	await expect
		.poll(async () => (await localRecords(page)).map(([, text]) => text), POLL)
		.toContain("left behind");
	await expect.poll(() => savedAnswer(world)).toBe("left behind");
	/// The instructor closes the attempt while the page is away.
	await prisma.response.update({
		where: { id: world.attempt.id },
		data: { acceptingSubmissions: false },
	});

	await page.reload();

	await expect(page.getByRole("textbox")).toHaveCount(0);
	await expect.poll(() => localRecords(page), POLL).toEqual([]);
	expect(errors).toEqual([]);
});

//
// R29: the page opens the monitor only when the exam's switch is on
//

test("with the exam switch off for the type, an open local switch loads and sends nothing", async ({
	page,
}) => {
	const world = await makeWorld({ type: "PRACTICE" });
	const errors = watchErrors(page);
	const history = watchHistoryRequests(page);
	const chunks: string[] = [];
	page.on("request", (request) => {
		if (request.url().includes("answer-edit")) chunks.push(request.url());
	});
	await openStudent(page, world);

	await answerBox(page).pressSequentially("practice words", { delay: 20 });
	await expect.poll(() => savedAnswer(world)).toBe("practice words");
	await flushHistory(page);

	expect(chunks).toEqual([]);
	expect(history.all()).toBe(0);
	expect(
		await page.evaluate(async () => (await indexedDB.databases()).length),
	).toBe(0);
	expect(await storedField(world)).toBeNull();
	expect(errors).toEqual([]);
});

test("after the instructor turns a PRACTICE exam on, pages opened afterwards collect", async ({
	page,
	playwright,
	baseURL,
}) => {
	const world = await makeWorld({ type: "PRACTICE" });
	await setSwitch(playwright, baseURL, world, true);
	const errors = watchErrors(page);
	await openStudent(page, world);

	await answerBox(page).pressSequentially("now recorded", { delay: 20 });

	await expect
		.poll(() => deliveredText(page, world), POLL)
		.toBe("now recorded");
	expect(errors).toEqual([]);
});

//
// R31: switching off with the exam in progress reaches the open page
//

/// A student page with the monitor active: one delivery is on the server before anything else happens.
async function activeStudent(page: Page, world: World) {
	await openStudent(page, world);
	await answerBox(page).pressSequentially("before ", { delay: 20 });
	await expect.poll(() => deliveredText(page, world), POLL).toBe("before ");
}

test("the next saved answer switches the page's history off, and the student keeps typing, saving and finishing", async ({
	page,
	playwright,
	baseURL,
}) => {
	const world = await makeWorld({ type: "EXAM" });
	const errors = watchErrors(page);
	const history = watchHistoryRequests(page);
	await activeStudent(page, world);
	/// Words the page has collected and not sent when the switch goes off.
	await answerBox(page).pressSequentially("pending ", { delay: 20 });
	await expect.poll(() => savedAnswer(world)).toBe("before pending ");
	const rowsBefore = await snapshotRows(world);

	await setSwitch(playwright, baseURL, world, false);
	const reported = page.waitForResponse(async (response) => {
		if (!response.url().includes("exam.answer")) return false;
		return answerHistoryOf(await response.text()) === false;
	});
	await answerBox(page).pressSequentially("after", { delay: 20 });
	await reported;
	await yieldToPage(page);
	const sendsAtSwitchOff = history.sends();
	const requestsAtSwitchOff = history.all();

	await flushHistory(page);
	await submitAndReload(page);

	expect(await savedAnswer(world)).toBe("before pending after");
	await expect.poll(() => finished(world)).toBe(true);
	/// The page stopped on its own: not one more request, not even the final flush.
	expect(history.sends()).toBe(sendsAtSwitchOff);
	expect(history.all()).toBe(requestsAtSwitchOff);
	/// Nothing was stored after the switch went off, neither "after" nor the words collected before it.
	expect(await snapshotRows(world)).toEqual(rowsBefore);
	expect(errors).toEqual([]);
});

test("the next history delivery learns the switch is off: nothing is stored and the page stops sending", async ({
	page,
	playwright,
	baseURL,
}) => {
	const world = await makeWorld({ type: "EXAM" });
	const errors = watchErrors(page);
	const history = watchHistoryRequests(page);
	await activeStudent(page, world);
	await answerBox(page).pressSequentially("pending ", { delay: 20 });
	const rowsBefore = await snapshotRows(world);
	await setSwitch(playwright, baseURL, world, false);
	const sendsBefore = history.sends();

	/// The words typed before the switch went off are sent after it: the server refuses them (R15).
	await expect
		.poll(async () => {
			await flushHistory(page);
			return history.sends();
		}, POLL)
		.toBeGreaterThan(sendsBefore);
	const sendsAfterRefusal = history.sends();
	const requestsAfterRefusal = history.all();
	await expect.poll(() => savedAnswer(world)).toBe("before pending ");

	await answerBox(page).pressSequentially("more", { delay: 20 });
	await expect.poll(() => savedAnswer(world)).toBe("before pending more");
	await flushHistory(page);
	await submitAndReload(page);

	expect(history.sends()).toBe(sendsAfterRefusal);
	expect(history.all()).toBe(requestsAfterRefusal);
	expect(await snapshotRows(world)).toEqual(rowsBefore);
	await expect.poll(() => finished(world)).toBe(true);
	expect(await savedAnswer(world)).toBe("before pending more");
	expect(errors).toEqual([]);
});

test("turning the switch on again does not bring an open page back", async ({
	page,
	playwright,
	baseURL,
}) => {
	const world = await makeWorld({ type: "EXAM" });
	const history = watchHistoryRequests(page);
	await activeStudent(page, world);
	await setSwitch(playwright, baseURL, world, false);
	const reported = page.waitForResponse(async (response) => {
		if (!response.url().includes("exam.answer")) return false;
		return answerHistoryOf(await response.text()) === false;
	});
	await answerBox(page).pressSequentially("off ", { delay: 20 });
	await reported;
	await yieldToPage(page);
	const rowsBefore = await snapshotRows(world);
	const requests = history.all();

	await setSwitch(playwright, baseURL, world, true);
	await answerBox(page).pressSequentially("on again", { delay: 20 });
	await expect.poll(() => savedAnswer(world)).toBe("before off on again");
	await flushHistory(page);
	await submitAndReload(page);

	expect(history.all()).toBe(requests);
	expect(await snapshotRows(world)).toEqual(rowsBefore);
});
