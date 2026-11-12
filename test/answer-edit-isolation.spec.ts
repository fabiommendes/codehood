import { expect, test } from "@playwright/test";
import { bundleForBrowser, STORAGE_MODULE } from "./helpers/answer-edit-bundle";

/// R7: whatever the monitor, storage and transport do, the student types, saves and submits.

type Api = typeof import("@/services/answer-edits/adapter") &
	typeof import("@/services/answer-edits/coordinator") &
	typeof import("@/services/answer-edits/monitor") &
	typeof import("@/services/answer-edits/storage");

declare global {
	interface Window {
		isolationApi: Api;
		harness: {
			sent: { id: string; text: string }[];
			errors: string[];
			attachMs: number;
			counts: { monitor: number; sends: number; inspects: number };
			adapter: InstanceType<Api["AnswerEditAdapter"]>;
			submit(): Promise<{ finishMs: number; flushMs: number; texts: string[] }>;
		};
	}
}

const SCENARIOS = [
	"healthy",
	"monitor-throws",
	"store-rejects",
	"store-hangs",
	"store-quota",
	"transport-hangs",
	"transport-errors",
	"open-throws",
	"open-rejects",
	"all",
] as const;
type Scenario = (typeof SCENARIOS)[number];

const CEILING_MS = 800;
let bundle: string;

test.beforeAll(async () => {
	bundle = await bundleForBrowser("isolationApi", [
		'export * from "@/services/answer-edits/adapter";',
		'export * from "@/services/answer-edits/coordinator";',
		'export * from "@/services/answer-edits/monitor";',
		STORAGE_MODULE,
	]);
});

/// Build the exam page stand-in: textareas wired as the exam page would be, answer channel first.
async function mount(options: { scenario: Scenario; ceilingMs: number }) {
	const api = window.isolationApi;
	const { scenario } = options;
	const has = (...names: Scenario[]) =>
		scenario === "all" || names.includes(scenario);
	const never = () => new Promise<never>(() => {});
	const quota = () => new DOMException("full", "QuotaExceededError");
	const counts = { monitor: 0, sends: 0, inspects: 0 };
	const errors: string[] = [];
	window.addEventListener("unhandledrejection", (event) =>
		errors.push(`rejection: ${String(event.reason)}`),
	);
	window.addEventListener("error", (event) =>
		errors.push(`error: ${event.message}`),
	);

	const realStore = await api.openIndexedDbEditStore({
		ownerId: "owner",
		indexedDB,
		databasePrefix: `isolation-${scenario}`,
	});
	const store = has("store-rejects", "store-hangs", "store-quota")
		? (new Proxy(realStore, {
				get: () => () =>
					scenario === "store-hangs"
						? never()
						: scenario === "store-quota"
							? Promise.reject(quota())
							: Promise.reject(new Error("IndexedDB is gone")),
			}) as typeof realStore)
		: realStore;
	const coordinator = new api.AnswerEditCoordinator({
		ownerId: "owner",
		attemptId: "attempt",
		store,
		scheduler: api.browserCoordinatorScheduler(),
		now: () => Date.now(),
		monotonicNow: () => performance.now(),
		random: () => 0.5,
		createSessionId: () => crypto.randomUUID(),
		storageTimeoutMs: 300,
		transport: {
			inspect: async () => {
				counts.inspects++;
				if (has("transport-hangs")) return never();
				if (has("transport-errors")) throw new Error("network down");
				return {
					text: "",
					revision: 0,
					nextSeq: 1,
					canWrite: true,
					receipts: [],
				};
			},
			send: async (request) => {
				counts.sends++;
				if (has("transport-hangs")) return never();
				if (has("transport-errors")) throw new Error("network down");
				return request.fields.map(({ questionId, field, batch }) => ({
					questionId,
					field,
					kind: "accepted" as const,
					receipt: {
						batchId: batch?.batchId ?? "",
						revision: (batch?.baseRevision ?? 0) + 1,
						lastSeq: (batch?.firstSeq ?? 0) + (batch?.edits.length ?? 1) - 1,
					},
				}));
			},
		},
	});

	/// The "all" scenario adds one field per monitor or open fault to the global store and transport faults.
	const ids = scenario === "all" ? ["f0", "f1", "f2", "f3"] : ["f0"];
	const port = {
		register: (field: { questionId: string; field: string }, handle: never) => {
			if (
				scenario === "open-throws" ||
				(scenario === "all" && field.questionId === "f1")
			)
				throw new Error("open threw");
			if (
				scenario === "open-rejects" ||
				(scenario === "all" && field.questionId === "f2")
			)
				return Promise.reject(new Error("open failed"));
			return coordinator.register(field, handle);
		},
		detach: (field: { questionId: string; field: string }) =>
			coordinator.detach(field),
		persist: () => coordinator.persist(),
		flush: () => coordinator.flush(),
		dispose: () => coordinator.dispose(),
	};
	let created = 0;
	const adapter = new api.AnswerEditAdapter({
		coordinator: port as never,
		now: () => performance.now(),
		flushCeilingMs: options.ceilingMs,
		createMonitor: ({ initialText, sessionId }) => {
			const real = new api.AnswerEditMonitor({
				initialText,
				sessionId,
				baseRevision: 0,
				firstSeq: 1,
				now: () => performance.now(),
			});
			const throwing =
				scenario === "monitor-throws" ||
				(scenario === "all" && ++created === 1);
			return new Proxy(real, {
				get(target, prop) {
					const value = Reflect.get(target, prop, target);
					if (typeof value !== "function") return value;
					return (...args: unknown[]) => {
						counts.monitor++;
						if (throwing && prop !== "then") throw new Error("monitor boom");
						return value.apply(target, args);
					};
				},
			});
		},
	});

	const sent: { id: string; text: string }[] = [];
	const t0 = performance.now();
	for (const id of ids) {
		const textarea = document.createElement("textarea");
		textarea.id = id;
		document.body.append(textarea);
		const field = { questionId: id, field: "answer" };
		adapter.attach(field, textarea.value);
		textarea.addEventListener("input", () => {
			sent.push({ id, text: textarea.value }); // the answer channel, first
			adapter.input(field, textarea.value);
		});
	}
	const attachMs = performance.now() - t0;
	window.harness = {
		sent,
		errors,
		attachMs,
		counts,
		adapter,
		async submit() {
			const start = performance.now();
			const texts = ids.map(
				(id) => (document.getElementById(id) as HTMLTextAreaElement).value,
			);
			const finishMs = performance.now() - start; // finish() runs right here
			await adapter.flushFinal();
			return { finishMs, flushMs: performance.now() - start, texts };
		},
	};
}

test.beforeEach(async ({ page }) => {
	await page.goto("/");
	await page.addScriptTag({ content: bundle });
});

for (const scenario of SCENARIOS) {
	test(`the student types, saves and submits with fault: ${scenario}`, async ({
		page,
	}) => {
		const pageErrors: string[] = [];
		page.on("pageerror", (error) => pageErrors.push(error.message));
		await page.evaluate<void, Parameters<typeof mount>[0]>(mount, {
			scenario,
			ceilingMs: CEILING_MS,
		});
		const ids = scenario === "all" ? ["f0", "f1", "f2", "f3"] : ["f0"];
		expect(await page.evaluate(() => window.harness.attachMs)).toBeLessThan(50);

		/// Typing starts at once, before the monitor can possibly be ready.
		for (const id of ids) await page.locator(`#${id}`).pressSequentially("abc");
		await page.waitForTimeout(700);
		for (const id of ids) await page.locator(`#${id}`).pressSequentially("def");
		const pasted = "é🙂\n".repeat(30_000);
		await page.evaluate(
			({ ids, pasted }) => {
				for (const id of ids) {
					const textarea = document.getElementById(id) as HTMLTextAreaElement;
					textarea.value = pasted;
					textarea.dispatchEvent(
						new InputEvent("input", { inputType: "insertFromPaste" }),
					);
				}
			},
			{ ids, pasted },
		);

		const result = await page.evaluate(() => window.harness.submit());
		expect(result.finishMs).toBeLessThan(20);
		expect(result.flushMs).toBeLessThan(CEILING_MS + 500);
		expect(result.texts).toEqual(ids.map(() => pasted));

		const sent = await page.evaluate(() => window.harness.sent);
		for (const id of ids) {
			const texts = sent.filter((entry) => entry.id === id).map((e) => e.text);
			expect(texts).toEqual([
				"a",
				"ab",
				"abc",
				"abcd",
				"abcde",
				"abcdef",
				pasted,
			]);
		}

		await page.waitForTimeout(1200);
		expect(await page.evaluate(() => window.harness.errors)).toEqual([]);
		expect(pageErrors).toEqual([]);

		if (scenario === "healthy") {
			const counts = await page.evaluate(() => window.harness.counts);
			expect(counts.sends).toBeGreaterThan(0);
		}
	});
}

test("the kill switch makes the adapter inert in the middle of typing", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	await page.evaluate<void, Parameters<typeof mount>[0]>(mount, {
		scenario: "healthy",
		ceilingMs: CEILING_MS,
	});
	await page.locator("#f0").pressSequentially("abc");
	await page.waitForFunction(() => window.harness.counts.monitor > 0);
	await page.evaluate(() => window.harness.adapter.disable());
	await page.waitForTimeout(300);
	const before = await page.evaluate(() => ({ ...window.harness.counts }));

	await page.locator("#f0").pressSequentially("def");
	const result = await page.evaluate(() => window.harness.submit());
	await page.waitForTimeout(1500);

	const after = await page.evaluate(() => ({ ...window.harness.counts }));
	expect(after).toEqual(before);
	expect(result.flushMs).toBeLessThan(50);
	expect(result.texts).toEqual(["abcdef"]);
	expect(
		(await page.evaluate(() => window.harness.sent)).map((e) => e.text),
	).toEqual(["a", "ab", "abc", "abcd", "abcde", "abcdef"]);
	expect(await page.evaluate(() => window.harness.adapter.isActive())).toBe(
		false,
	);
	expect(await page.evaluate(() => window.harness.errors)).toEqual([]);
	expect(pageErrors).toEqual([]);
});
