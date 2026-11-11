import { FULL_ACCESS } from "@/auth/actor";
import { draftKey } from "@/components/exam/code-draft";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { courseHref } from "@/urls";
import { expect, type Page, type Route, test } from "./fixtures";
import { logInAs, resetDatabase, seedUser } from "./stories/helpers";

// Getting an answer to the server through failures: retries, hung requests,
// the deadline, closing the page, and what the student is told when it fails.

test.beforeEach(resetDatabase);

const ANSWER_ACTION = "**/_actions/exam.answer**";
const FINISH_ACTION = "**/_actions/exam.finish**";
const SECOND = 1000;

interface Setup {
	page: Page;
	/// Seconds left on a one-minute attempt; omit for an exam without a deadline.
	secondsLeft?: number;
	/// Slugs of code essays to add after the text essay `text`.
	codes?: string[];
}

/// A student in an open attempt at an exam with a text essay, `text`, and the code essays asked for.
async function setup(options: Setup) {
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
	for (const slug of options.codes ?? []) {
		await db.question.create(
			{
				status: "PUBLISHED",
				version: "1",
				course: course.id,
				slug,
				question: {
					type: "essay",
					content: "code",
					highlight: "javascript",
					stem: "Print something.",
					tags: [],
				},
			},
			FULL_ACCESS,
		);
	}
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: "delivery-exam",
		type: "EXAM",
		status: "ONGOING",
		duration: options.secondsLeft === undefined ? undefined : { minutes: 1 },
		questions: [
			{ slug: "text" },
			...(options.codes ?? []).map((slug) => ({ slug })),
		],
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
	await logInAs(options.page, student);
	return {
		student,
		course,
		exam,
		attempt,
		url: `${href}/exams/${exam.slug}`,
		draftKey: (question: string) =>
			draftKey({
				username: student.username,
				course: href.replace(/^\//, ""),
				exam: exam.slug,
				question,
			}),
	};
}

type Prepared = Awaited<ReturnType<typeof setup>>;

/// The latest payload the server holds for `question`, or null.
async function saved(s: Prepared, question = "text"): Promise<unknown> {
	const [attempt] = await db.response.findMany(
		{ course: s.course.id, exam: s.exam.slug, author: s.student.username },
		FULL_ACCESS,
	);
	return (
		attempt?.submissions.filter((it) => it.question === question).at(-1)
			?.payload ?? null
	);
}

/// Saves `payload` to `question` as the student, bypassing the page.
async function seedAnswer(s: Prepared, question: string, payload: string) {
	await db.response.submit(
		{
			course: s.course.id,
			exam: s.exam.slug,
			question,
			author: s.student.username,
			payload,
		},
		FULL_ACCESS,
	);
}

const answerBox = (page: Page) => page.getByRole("textbox").first();
const editor = (page: Page) => page.locator("[data-code-runner] .cm-content");

test("a failed save is retried without another edit", async ({ page }) => {
	const s = await setup({ page });
	let calls = 0;
	await page.route(ANSWER_ACTION, (route) =>
		++calls <= 2 ? route.abort() : route.continue(),
	);
	await page.goto(s.url);

	await answerBox(page).fill("kept through two failures");

	await expect
		.poll(() => saved(s), { timeout: 20 * SECOND })
		.toBe("kept through two failures");
	expect(calls).toBeGreaterThanOrEqual(3);
});

test("the browser coming back online sends the answer at once", async ({
	page,
}) => {
	const s = await setup({ page });
	let offline = true;
	await page.route(ANSWER_ACTION, (route) =>
		offline ? route.abort() : route.continue(),
	);
	await page.goto(s.url);
	await answerBox(page).fill("sent on reconnect");
	await expect(page.getByText("Not saved").first()).toBeVisible();

	offline = false;
	await page.evaluate(() => window.dispatchEvent(new Event("online")));

	await expect.poll(() => saved(s), { timeout: 700 }).toBe("sent on reconnect");
});

test("a failed older save never lands after a newer one", async ({ page }) => {
	const s = await setup({ page });
	let calls = 0;
	await page.route(ANSWER_ACTION, async (route) => {
		if (++calls === 1) {
			await new Promise((resolve) => setTimeout(resolve, 400));
			return route.abort();
		}
		return route.continue();
	});
	await page.goto(s.url);

	await answerBox(page).fill("one");
	await answerBox(page).blur();
	await answerBox(page).fill("two");
	await answerBox(page).blur();

	await expect.poll(() => saved(s)).toBe("two");
	// Past the first retry delay, which would resend the failed "one".
	await page.waitForTimeout(3 * SECOND);
	expect(await saved(s)).toBe("two");
});

test("a request that never answers times out, and the answer is sent again", async ({
	page,
}) => {
	const s = await setup({ page });
	await page.clock.install();
	let calls = 0;
	await page.route(ANSWER_ACTION, (route: Route) => {
		// The first request hangs for good.
		if (++calls > 1) return route.continue();
	});
	await page.goto(s.url);
	await answerBox(page).fill("after the hang");
	await expect.poll(() => calls).toBe(1);

	await page.clock.fastForward(16 * SECOND);
	await expect(page.getByText("Not saved").first()).toBeVisible();
	await page.clock.fastForward(5 * SECOND);

	await expect.poll(() => saved(s)).toBe("after the hang");
});

test("a submit that cannot reach the server says so and can be tried again", async ({
	page,
}) => {
	const s = await setup({ page });
	await page.route(FINISH_ACTION, (route) => route.abort());
	await page.goto(s.url);
	await answerBox(page).fill("ready");
	await expect.poll(() => saved(s)).toBe("ready");

	await page
		.getByRole("button", { name: /^Submit/ })
		.first()
		.click();
	await page
		.getByRole("dialog")
		.getByRole("button", { name: /submit|confirm/i })
		.click();

	await expect(page.getByRole("alert").first()).toContainText(/try again/i);
	await expect(
		page.getByRole("button", { name: /^Submit/ }).first(),
	).toBeEnabled();
});

test("an answer still failing as the deadline nears is sent before it", async ({
	page,
}) => {
	const s = await setup({ page, secondsLeft: 40 });
	await page.clock.install();
	let offline = true;
	await page.route(ANSWER_ACTION, (route) =>
		offline ? route.abort() : route.continue(),
	);
	await page.goto(s.url);
	await answerBox(page).fill("last minute");
	await expect(page.getByText("Not saved").first()).toBeVisible();

	// Heals when the last seconds begin.
	await page.clock.fastForward(32 * SECOND);
	await expect(page.getByText(/^\d s left$/).first()).toBeVisible();
	offline = false;

	await expect
		.poll(() => saved(s), { timeout: 5 * SECOND })
		.toBe("last minute");
	// The save answered with the server's clock, which undid the jump.
	await page.clock.fastForward(45 * SECOND);
	await expect(page.getByText("Submitted").first()).toBeVisible();
	await expect(page.getByRole("alert")).toHaveCount(0);
});

test("an answer that only gets through just after the deadline is still saved", async ({
	page,
}) => {
	const s = await setup({ page, secondsLeft: 3 });
	let offline = true;
	await page.route(ANSWER_ACTION, (route) =>
		offline ? route.abort() : route.continue(),
	);
	await page.goto(s.url);
	await answerBox(page).fill("just after");
	await expect(page.getByText("Not saved").first()).toBeVisible();

	// Heals once the countdown has run out, inside the server's grace.
	await page.waitForTimeout(5 * SECOND);
	offline = false;

	await expect.poll(() => saved(s), { timeout: 8 * SECOND }).toBe("just after");
	await expect(page.getByText("Submitted").first()).toBeVisible({
		timeout: 20 * SECOND,
	});
	await expect(page.getByRole("alert")).toHaveCount(0);
});

test("typing after the deadline is locked, and the answer sent in the grace is the one from the deadline", async ({
	page,
}) => {
	const s = await setup({ page, secondsLeft: 3 });
	let offline = true;
	await page.route(ANSWER_ACTION, (route) =>
		offline ? route.abort() : route.continue(),
	);
	await page.goto(s.url);
	await answerBox(page).fill("at the deadline");
	await expect(page.getByText("Not saved").first()).toBeVisible();

	await expect(page.getByText(/Sending your last answers/)).toBeVisible({
		timeout: 10 * SECOND,
	});
	// The answer is shown read-only: there is no field left to type in.
	await expect(page.getByRole("textbox")).toHaveCount(0);
	await expect(page.getByText("at the deadline")).toBeVisible();
	offline = false;

	await expect
		.poll(() => saved(s), { timeout: 8 * SECOND })
		.toBe("at the deadline");
	await expect(page.getByText("Submitted").first()).toBeVisible({
		timeout: 20 * SECOND,
	});
	expect(await saved(s)).toBe("at the deadline");
});

test("when time runs out with answers the server never got, the page says which", async ({
	page,
}) => {
	const s = await setup({ page, secondsLeft: 40 });
	await page.clock.install();
	await page.route(ANSWER_ACTION, (route) => route.abort());
	await page.goto(s.url);
	await answerBox(page).fill("lost to the network");
	await expect(page.getByText("Not saved").first()).toBeVisible();

	await page.clock.fastForward(45 * SECOND);
	const warning = page.getByRole("alert").filter({ hasText: /Q1/ });
	await expect(warning).toContainText(/did not reach the server/i);
	await expect(page.getByText("lost to the network")).toBeVisible();
	expect(await saved(s)).toBeNull();
});

test("the page asks before closing while an answer is unsaved", async ({
	page,
}) => {
	const s = await setup({ page });
	let offline = true;
	await page.route(ANSWER_ACTION, (route) =>
		offline ? route.abort() : route.continue(),
	);
	await page.goto(s.url);
	const closing = () =>
		page.evaluate(() => {
			const event = new Event("beforeunload", { cancelable: true });
			window.dispatchEvent(event);
			return event.defaultPrevented;
		});

	await answerBox(page).fill("unsent");
	await expect(page.getByText("Not saved").first()).toBeVisible();
	expect(await closing()).toBe(true);

	offline = false;
	await page.evaluate(() => window.dispatchEvent(new Event("online")));
	await expect.poll(() => saved(s)).toBe("unsent");
	await expect.poll(closing).toBe(false);
});

test("opening a submitted attempt keeps a draft that differs from the saved answer", async ({
	page,
}) => {
	const s = await setup({ page, codes: ["kept", "settled"] });
	await seedAnswer(s, "kept", "console.log('server')");
	await seedAnswer(s, "settled", "console.log('same')");
	await db.response.finish(
		{ course: s.course.id, exam: s.exam.slug, author: s.student.username },
		FULL_ACCESS,
	);
	await page.goto("/login");
	await page.evaluate(
		([kept, settled]) => {
			const entry = (code: string) =>
				JSON.stringify({ code, savedAt: Date.now() });
			localStorage.setItem(kept as string, entry("console.log('never sent')"));
			localStorage.setItem(settled as string, entry("console.log('same')"));
		},
		[s.draftKey("kept"), s.draftKey("settled")],
	);

	await page.goto(s.url);
	await expect(page.getByText("Submitted").first()).toBeVisible();

	const read = (key: string) =>
		page.evaluate((k) => localStorage.getItem(k), key);
	await expect.poll(() => read(s.draftKey("settled"))).toBeNull();
	expect(JSON.parse((await read(s.draftKey("kept"))) ?? "null").code).toBe(
		"console.log('never sent')",
	);
});

/// Every payload the server holds for `question`, oldest first.
async function history(s: Prepared, question = "text"): Promise<unknown[]> {
	const [attempt] = await db.response.findMany(
		{ course: s.course.id, exam: s.exam.slug, author: s.student.username },
		FULL_ACCESS,
	);
	return (
		attempt?.submissions
			.filter((it) => it.question === question)
			.map((it) => it.payload) ?? []
	);
}

test("an old request that lands late does not replace the newer answer", async ({
	page,
}) => {
	const s = await setup({ page });
	await page.clock.install();
	let held: Route | undefined;
	let calls = 0;
	await page.route(ANSWER_ACTION, (route: Route) => {
		// The first request hangs until the test lets it through.
		if (++calls === 1) {
			held = route;
			return;
		}
		return route.continue();
	});
	await page.goto(s.url);
	await answerBox(page).fill("old");
	await expect.poll(() => calls).toBe(1);
	await answerBox(page).fill("new");

	await page.clock.fastForward(16 * SECOND);
	await expect.poll(() => saved(s)).toBe("new");
	await held?.continue();

	// The old request is accepted after the new one, and the page notices.
	await expect.poll(() => history(s)).toContain("old");
	await expect.poll(() => saved(s), { timeout: 10 * SECOND }).toBe("new");
});

const readDraft = (page: Page, key: string) =>
	page.evaluate((k) => localStorage.getItem(k), key);

/// The text of the draft stored under `key`, or null.
const draftText = async (page: Page, key: string) =>
	JSON.parse((await readDraft(page, key)) ?? "null")?.code ?? null;

/// Opens `url` and waits for the attempt island to hydrate, since input typed before that is lost.
async function openHydrated(page: Page, url: string, reload = false) {
	if (reload) await page.reload();
	else await page.goto(url);
	await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
}

test("typed text survives a reload during an outage and reaches the server later", async ({
	page,
}) => {
	const s = await setup({ page });
	let offline = true;
	await page.route(ANSWER_ACTION, (route) =>
		offline ? route.abort() : route.continue(),
	);
	await openHydrated(page, s.url);
	await answerBox(page).fill("typed while offline");
	await expect
		.poll(() => draftText(page, s.draftKey("text")))
		.toBe("typed while offline");
	await expect(page.getByText("Not saved").first()).toBeVisible();
	expect(await saved(s)).toBeNull();

	await openHydrated(page, s.url, true);
	await expect(answerBox(page)).toHaveValue("typed while offline");

	offline = false;
	await page.evaluate(() => window.dispatchEvent(new Event("online")));
	await expect.poll(() => saved(s)).toBe("typed while offline");
	await expect.poll(() => readDraft(page, s.draftKey("text"))).toBeNull();
});

test("the draft is removed once the server confirms the text", async ({
	page,
}) => {
	const s = await setup({ page });
	await openHydrated(page, s.url);
	await answerBox(page).fill("confirmed");
	await expect.poll(() => saved(s)).toBe("confirmed");
	await expect.poll(() => readDraft(page, s.draftKey("text"))).toBeNull();
});

test("a draft of another attempt is not restored", async ({ page }) => {
	const s = await setup({ page });
	await page.goto("/login");
	await page.evaluate(
		(key) =>
			localStorage.setItem(
				key,
				JSON.stringify({ code: "someone else", savedAt: Date.now() }),
			),
		draftKey({
			username: s.student.username,
			course: "other/course/teacher",
			exam: s.exam.slug,
			question: "text",
		}),
	);

	await page.goto(s.url);
	await expect(answerBox(page)).toHaveValue("");
});

test("a draft equal to the saved text is dropped on open", async ({ page }) => {
	const s = await setup({ page });
	await seedAnswer(s, "text", "same");
	await page.goto("/login");
	await page.evaluate(
		(key) =>
			localStorage.setItem(
				key,
				JSON.stringify({ code: "same", savedAt: Date.now() }),
			),
		s.draftKey("text"),
	);

	await page.goto(s.url);
	await expect.poll(() => readDraft(page, s.draftKey("text"))).toBeNull();
});

test("clearing the text during an outage is kept across a reload", async ({
	page,
}) => {
	const s = await setup({ page });
	await seedAnswer(s, "text", "old answer");
	let offline = true;
	await page.route(ANSWER_ACTION, (route) =>
		offline ? route.abort() : route.continue(),
	);
	await openHydrated(page, s.url);
	await answerBox(page).fill("typed");
	await answerBox(page).fill("");
	await expect.poll(() => draftText(page, s.draftKey("text"))).toBe("");
	await openHydrated(page, s.url, true);
	await expect.poll(() => draftText(page, s.draftKey("text"))).toBe("");

	offline = false;
	await page.evaluate(() => window.dispatchEvent(new Event("online")));
	await expect.poll(() => saved(s)).toBeNull();
});

// A saved essay answer must show in its textarea after a reload. The other
// kinds of field are covered by the hydration specs of mdq-js.
test("a saved essay answer shows in its textarea after a reload", async ({
	page,
}) => {
	const s = await setup({ page });
	await seedAnswer(s, "text", "saved essay");
	await openHydrated(page, s.url);

	await expect(page.locator("textarea.mdq-textarea")).toHaveValue(
		"saved essay",
	);
});

// Nothing local may stop an answer from reaching the server: the page works
// the same when the browser's storage refuses, throws or holds garbage.

/// Script that breaks `localStorage`, run before the page's own scripts.
const STORAGE_FAULTS = {
	quota: () => {
		Storage.prototype.setItem = () => {
			throw new DOMException("full", "QuotaExceededError");
		};
	},
	blocked: () => {
		Object.defineProperty(window, "localStorage", {
			get() {
				throw new DOMException("denied", "SecurityError");
			},
		});
	},
	"every method throws": () => {
		const fail = () => {
			throw new DOMException("denied", "SecurityError");
		};
		Storage.prototype.getItem = fail;
		Storage.prototype.setItem = fail;
		Storage.prototype.removeItem = fail;
		Storage.prototype.key = fail;
		Object.defineProperty(Storage.prototype, "length", { get: fail });
	},
} as const;

for (const [fault, breakStorage] of Object.entries(STORAGE_FAULTS)) {
	test(`answers are saved and submitted when localStorage fails: ${fault}`, async ({
		page,
	}) => {
		const s = await setup({ page, codes: ["code"] });
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.addInitScript(breakStorage);
		await openHydrated(page, s.url);

		await answerBox(page).fill("typed text");
		await expect.poll(() => saved(s)).toBe("typed text");
		await editor(page).fill("console.log(1)");
		await expect.poll(() => saved(s, "code")).toBe("console.log(1)");

		await page
			.getByRole("button", { name: /^Submit/ })
			.first()
			.click();
		const finished = page.waitForResponse(FINISH_ACTION);
		await page
			.getByRole("dialog")
			.getByRole("button", { name: /submit|confirm/i })
			.click();
		expect((await finished).ok()).toBe(true);
		await expect(page.getByRole("alert")).toHaveCount(0);
		expect(errors).toEqual([]);
	});
}

test("answers are saved when stored drafts are corrupt", async ({ page }) => {
	const s = await setup({ page, codes: ["code"] });
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const garbage: Record<string, string> = {
		[s.draftKey("text")]: "{not json",
		[s.draftKey("code")]: JSON.stringify({ code: 7, savedAt: "x" }),
	};
	await page.addInitScript((items) => {
		for (const [key, value] of Object.entries(items)) {
			localStorage.setItem(key, value);
		}
	}, garbage);
	await openHydrated(page, s.url);

	await answerBox(page).fill("typed text");
	await expect.poll(() => saved(s)).toBe("typed text");
	await editor(page).fill("console.log(1)");
	await expect.poll(() => saved(s, "code")).toBe("console.log(1)");
	expect(errors).toEqual([]);
});

test("the page still asks before closing when the draft cannot be written", async ({
	page,
}) => {
	const s = await setup({ page });
	await page.route(ANSWER_ACTION, (route) => route.abort());
	await page.addInitScript(STORAGE_FAULTS.quota);
	await openHydrated(page, s.url);
	await answerBox(page).fill("unsent");
	await expect(page.getByText("Not saved").first()).toBeVisible();
	const prevented = await page.evaluate(() => {
		const event = new Event("beforeunload", { cancelable: true });
		window.dispatchEvent(event);
		return event.defaultPrevented;
	});
	expect(prevented).toBe(true);
});
