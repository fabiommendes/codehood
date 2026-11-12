import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { courseHref } from "@/urls";
import { expect, type Page, test } from "./fixtures";
import { logInAs, resetDatabase, seedUser } from "./stories/helpers";

// R7 against the real exam page: whatever the answer-edit monitor, its
// storage and its code chunk do, the student types, saves and finishes.

test.beforeEach(resetDatabase);

const FINISH_ACTION = "**/_actions/exam.finish**";
const SECOND = 1000;
const SWITCH_KEY = "codehood.answerHistory";
const MONITOR_CHUNK = "**/answer-edit-session*";
/// Longest the page may take to finish with every monitor fault on: the final flush ceiling plus the round trip.
const FINISH_BUDGET_MS = 6 * SECOND;
/// Typing 300 input events in a row must stay far from anything a student could feel.
const TYPING_BUDGET_MS = 1500;

/// Faults injected before the page runs. Each one counts its hits in `window.faultHits`.
const FAULTS = {
	"indexeddb open throws": () => {
		const hits = { count: 0 };
		Object.assign(window, { faultHits: hits });
		IDBFactory.prototype.open = () => {
			hits.count++;
			throw new DOMException("denied", "SecurityError");
		};
	},
	"indexeddb hangs forever": () => {
		const hits = { count: 0 };
		Object.assign(window, { faultHits: hits });
		/// A request that never fires any event.
		IDBFactory.prototype.open = () => {
			hits.count++;
			return {} as IDBOpenDBRequest;
		};
	},
	"quota exceeded on write": () => {
		const hits = { count: 0 };
		Object.assign(window, { faultHits: hits });
		const quota = () => new DOMException("full", "QuotaExceededError");
		IDBObjectStore.prototype.put = () => {
			hits.count++;
			throw quota();
		};
		const setItem = Storage.prototype.setItem;
		Storage.prototype.setItem = function (key, value) {
			if (String(key).startsWith('["codehood-answer-text"')) {
				hits.count++;
				throw quota();
			}
			return setItem.call(this, key, value);
		};
	},
	"exception inside the monitor on input": () => {
		const hits = { count: 0 };
		Object.assign(window, { faultHits: hits });
		const now = performance.now.bind(performance);
		/// Only calls coming from the monitor chunk fail.
		performance.now = () => {
			if (new Error().stack?.includes("answer-edit-session")) {
				hits.count++;
				throw new Error("monitor boom");
			}
			return now();
		};
	},
	"final flush that never settles": () => {
		const hits = { count: 0 };
		Object.assign(window, { faultHits: hits });
		/// The monitor's waits never settle: its ceiling timer is swallowed and so is its own join of persist and flush.
		const settled = Promise.allSettled.bind(Promise);
		Promise.allSettled = ((values: Iterable<unknown>) => {
			if (new Error().stack?.includes("answer-edit-session")) {
				hits.count++;
				return new Promise(() => {});
			}
			return settled(values);
		}) as typeof Promise.allSettled;
		const setTimeoutOriginal = window.setTimeout.bind(window);
		window.setTimeout = ((
			callback: TimerHandler,
			delay?: number,
			...args: unknown[]
		) => {
			if (
				(delay ?? 0) >= 1000 &&
				new Error().stack?.includes("answer-edit-session")
			) {
				hits.count++;
				return 0;
			}
			return setTimeoutOriginal(callback, delay, ...args);
		}) as typeof setTimeout;
	},
} as const;
type Fault = keyof typeof FAULTS;

/// A student in an open attempt at an exam with one text essay, with the history switch on.
async function setup(
	page: Page,
	options: { secondsLeft?: number; switchOn?: boolean } = {},
) {
	const student = await seedUser({ role: "STUDENT" });
	const course = await persistedCourseFactory.create();
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	await db.question.create(
		{
			status: "PUBLISHED",
			version: "1",
			course: course.id,
			slug: "text",
			question: {
				type: "essay",
				content: "text",
				stem: "Say something.",
				tags: [],
			},
		},
		FULL_ACCESS,
	);
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: "isolation-exam",
		type: "EXAM",
		status: "ONGOING",
		duration: options.secondsLeft === undefined ? undefined : { minutes: 1 },
		questions: [{ slug: "text" }],
	});
	const attempt = await db.response.create(
		{ course: course.id, exam: exam.slug, author: student.username },
		FULL_ACCESS,
	);
	if (options.secondsLeft !== undefined) {
		await prisma.response.update({
			where: { id: attempt.id },
			data: {
				createdAt: new Date(Date.now() - (60 - options.secondsLeft) * SECOND),
			},
		});
	}
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});
	await logInAs(page, student);
	if (options.switchOn !== false) {
		await page.addInitScript(
			(key) => localStorage.setItem(key, "on"),
			SWITCH_KEY,
		);
	}
	return { student, course, exam, url: `${href}/exams/${exam.slug}` };
}

type Prepared = Awaited<ReturnType<typeof setup>>;

/// The latest payload the server holds for the text question, or null.
async function saved(s: Prepared): Promise<unknown> {
	const [attempt] = await db.response.findMany(
		{ course: s.course.id, exam: s.exam.slug, author: s.student.username },
		FULL_ACCESS,
	);
	return (
		attempt?.submissions.filter((it) => it.question === "text").at(-1)
			?.payload ?? null
	);
}

/// Whether the server closed the attempt to further answers, which is what `finish` does.
async function finished(s: Prepared): Promise<boolean> {
	const [attempt] = await db.response.findMany(
		{ course: s.course.id, exam: s.exam.slug, author: s.student.username },
		FULL_ACCESS,
	);
	return attempt?.acceptingSubmissions === false;
}

const answerBox = (page: Page) => page.getByRole("textbox").first();

/// Collects uncaught page errors, which a monitor failure must never cause.
function watchErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	return errors;
}

/// Types for real, then fires many input events in one burst; returns the burst's duration.
async function typeLikeAStudent(page: Page): Promise<number> {
	const box = answerBox(page);
	await box.pressSequentially("first words ", { delay: 20 });
	return await box.evaluate((element) => {
		const textarea = element as HTMLTextAreaElement;
		const start = performance.now();
		for (let i = 0; i < 300; i++) {
			textarea.value += "x";
			textarea.dispatchEvent(
				new InputEvent("input", { bubbles: true, inputType: "insertText" }),
			);
		}
		return performance.now() - start;
	});
}

const TYPED = `first words ${"x".repeat(300)}`;

/// Clicks through the submit dialog; resolves to how long the server took to see `finish`.
async function submit(page: Page): Promise<number> {
	await page
		.getByRole("button", { name: /^Submit/ })
		.first()
		.click();
	const response = page.waitForResponse(FINISH_ACTION);
	const start = Date.now();
	await page
		.getByRole("dialog")
		.getByRole("button", { name: /submit|confirm/i })
		.click();
	expect((await response).ok()).toBe(true);
	const took = Date.now() - start;
	/// The page reloads on its own after `finish`; ending the test with that request in flight would race the next reset.
	await expect(page.getByRole("textbox")).toHaveCount(0, {
		timeout: FINISH_BUDGET_MS,
	});
	await page.waitForLoadState("load");
	return took;
}

/// The history the page recorded in IndexedDB, as the texts of its records.
async function recordedTexts(page: Page): Promise<string[]> {
	return await page.evaluate(async () => {
		const names = (await indexedDB.databases())
			.map((entry) => entry.name ?? "")
			.filter((name) => name.includes("codehood-answer-edits"));
		const texts: string[] = [];
		for (const name of names) {
			const database = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open(name);
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			const records = await new Promise<unknown[]>((resolve, reject) => {
				const request = database
					.transaction("records")
					.objectStore("records")
					.getAll();
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			database.close();
			for (const record of records)
				if (record && typeof record === "object" && "text" in record)
					texts.push(String(record.text));
		}
		return texts;
	});
}

test("with the switch on, the history is recorded in this browser", async ({
	page,
}) => {
	const s = await setup(page);
	const errors = watchErrors(page);
	await page.goto(s.url);
	await typeLikeAStudent(page);

	await expect.poll(() => saved(s)).toBe(TYPED);
	await expect.poll(() => recordedTexts(page)).toContain(TYPED);
	await submit(page);
	await expect.poll(() => finished(s)).toBe(true);
	expect(errors).toEqual([]);
});

test("with the switch off, nothing of the monitor loads or is stored", async ({
	page,
}) => {
	const s = await setup(page, { switchOn: false });
	const errors = watchErrors(page);
	const requests: string[] = [];
	page.on("request", (request) => requests.push(request.url()));
	await page.goto(s.url);
	await typeLikeAStudent(page);

	await expect.poll(() => saved(s)).toBe(TYPED);
	await submit(page);
	await expect.poll(() => finished(s)).toBe(true);

	/// The page reloads on its own once the attempt is finished.
	await expect(page.getByRole("textbox")).toHaveCount(0);
	expect(requests.filter((url) => url.includes("answer-edit"))).toEqual([]);
	const traces = await page.evaluate(async () => ({
		databases: (await indexedDB.databases()).map((entry) => entry.name),
		keys: Object.keys(localStorage).filter((key) =>
			key.includes("codehood-answer"),
		),
	}));
	expect(traces).toEqual({ databases: [], keys: [] });
	expect(errors).toEqual([]);
});

for (const fault of Object.keys(FAULTS) as Fault[]) {
	test(`the student types, saves and finishes with the monitor failing: ${fault}`, async ({
		page,
	}) => {
		const s = await setup(page);
		const errors = watchErrors(page);
		await page.addInitScript(FAULTS[fault]);
		await page.goto(s.url);

		const typingMs = await typeLikeAStudent(page);
		expect(typingMs).toBeLessThan(TYPING_BUDGET_MS);
		await expect.poll(() => saved(s)).toBe(TYPED);

		/// The fault really happened, so the pass means the page survived it.
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						(window as unknown as { faultHits: { count: number } }).faultHits
							.count,
				),
			)
			.toBeGreaterThan(0);

		const finishMs = await submit(page);
		expect(finishMs).toBeLessThan(FINISH_BUDGET_MS);
		await expect.poll(() => finished(s)).toBe(true);
		await expect(page.getByRole("alert")).toHaveCount(0);
		expect(errors).toEqual([]);
	});
}

test("the student types, saves and finishes when the monitor chunk fails to load", async ({
	page,
}) => {
	const s = await setup(page);
	const errors = watchErrors(page);
	let attempts = 0;
	await page.route(MONITOR_CHUNK, (route) => {
		attempts++;
		return route.abort();
	});
	await page.goto(s.url);

	const typingMs = await typeLikeAStudent(page);
	expect(typingMs).toBeLessThan(TYPING_BUDGET_MS);
	await expect.poll(() => saved(s)).toBe(TYPED);
	expect(attempts).toBeGreaterThan(0);

	expect(await submit(page)).toBeLessThan(FINISH_BUDGET_MS);
	await expect.poll(() => finished(s)).toBe(true);
	expect(errors).toEqual([]);
});

test("a reload in the middle of typing keeps the text, with every monitor fault on", async ({
	page,
}) => {
	const s = await setup(page);
	const errors = watchErrors(page);
	await page.addInitScript(FAULTS["exception inside the monitor on input"]);
	await page.goto(s.url);

	await answerBox(page).pressSequentially("half a sent");
	await page.reload();
	await expect(answerBox(page)).toHaveValue("half a sent");
	await answerBox(page).pressSequentially("ence", { delay: 20 });

	await expect.poll(() => saved(s)).toBe("half a sentence");
	await submit(page);
	await expect.poll(() => finished(s)).toBe(true);
	expect(errors).toEqual([]);
});

for (const fault of [
	"exception inside the monitor on input",
	"quota exceeded on write",
] as Fault[]) {
	test(`the field is remounted at the deadline with the monitor failing: ${fault}`, async ({
		page,
	}) => {
		const s = await setup(page, { secondsLeft: 3 });
		const errors = watchErrors(page);
		await page.clock.install();
		await page.addInitScript(FAULTS[fault]);
		await page.goto(s.url);
		await answerBox(page).fill("written before the deadline");

		await page.clock.fastForward(5 * SECOND);
		/// The editor became a read-only view of the same answer.
		await expect(page.getByRole("textbox")).toHaveCount(0);
		await expect(page.getByText("written before the deadline")).toBeVisible();

		await expect
			.poll(() => saved(s), { timeout: 8 * SECOND })
			.toBe("written before the deadline");
		await expect(page.getByText("Submitted").first()).toBeVisible();
		expect(errors).toEqual([]);
	});
}

test("the page reloads into the finished state when the final history flush never settles", async ({
	page,
}) => {
	const s = await setup(page);
	const errors = watchErrors(page);
	await page.addInitScript(FAULTS["final flush that never settles"]);
	await page.goto(s.url);
	await typeLikeAStudent(page);
	await expect.poll(() => saved(s)).toBe(TYPED);
	/// Give the monitor time to open its field, so the final flush has work to hang on.
	await page.waitForTimeout(500);

	await submit(page);
	await expect.poll(() => finished(s)).toBe(true);
	/// The reload happens on the page's own timer, whatever the monitor does.
	await expect(page.getByRole("textbox")).toHaveCount(0, {
		timeout: FINISH_BUDGET_MS,
	});
	await expect(
		page.getByText(/submitted|grading|graded/i).first(),
	).toBeVisible();
	expect(errors).toEqual([]);
});
