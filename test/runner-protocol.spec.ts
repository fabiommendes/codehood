import { OUTPUT_MESSAGES_LIMIT, STDIN_LINE_MAX_BYTES } from "@/runner/protocol";
import { StdinChannels } from "@/runner/sandbox/stdin/sw";
import { expect, type Page, test } from "./fixtures";
import {
	collect,
	type Harness,
	loadFrame,
	messagesOf,
	run,
	send,
	start,
	statesOf,
	waitFor,
} from "./runner-harness";

/**
 * The runner frame protocol, exercised with the real frame, Worker and
 * drivers: the `fake` driver for every path of the protocol and the
 * JavaScript driver for its own behavior. Stdin tests run on both transports.
 */

const lines = (...commands: string[]) => commands.join("\n");

const TRANSPORTS = [
	["sab", ""],
	["sw", "?isolation=off"],
] as const;

test.describe("ready", () => {
	for (const [kind, query] of TRANSPORTS) {
		test(`announces protocol 1, the ${kind} transport and its drivers`, async ({
			page,
		}, testInfo) => {
			test.skip(
				kind === "sab" && testInfo.project.name !== "chromium",
				"cross-origin isolation through Document-Isolation-Policy is Chromium only",
			);
			const h = await loadFrame(page, query);
			const { languages, ...rest } = h.ready;
			expect(rest).toEqual({ type: "ready", protocol: 1, stdin: kind });
			expect([...languages].sort()).toEqual([
				"elm",
				"fake",
				"javascript",
				"lua",
				"prolog",
				"python",
				"typescript",
			]);
		});
	}
});

test.describe("fake driver", () => {
	test("out and err arrive in order", async ({ page }) => {
		const h = await loadFrame(page);
		const result = await run(h, lines("out a", "err b", "out c", "err d"));
		const outputs = result.messages.flatMap((m) =>
			m.type === "output" ? [`${m.stream}:${m.text}`] : [],
		);
		expect(outputs.join("")).toBe("stdout:a\nstderr:b\nstdout:c\nstderr:d\n");
		expect(result.exit).toMatchObject({ reason: "exited", code: 0 });
	});

	test("exit, crash and load-fail end with their reasons", async ({ page }) => {
		const h = await loadFrame(page);
		expect((await run(h, "exit 3")).exit).toMatchObject({
			reason: "exited",
			code: 3,
		});
		expect((await run(h, "crash boom")).exit).toMatchObject({
			reason: "crashed",
			code: null,
			message: "boom",
		});
		expect(
			(await run(h, lines("load-fail no runtime", "out x"))).exit,
		).toMatchObject({
			reason: "load-failed",
			code: null,
			message: "no runtime",
		});
	});

	test("progress arrives before running", async ({ page }) => {
		const h = await loadFrame(page);
		const result = await run(h, lines("progress 5 10", "out hi"));
		const types = result.messages.map((m) =>
			m.type === "status" ? `status:${m.state}` : m.type,
		);
		expect(types.indexOf("progress")).toBeGreaterThanOrEqual(0);
		expect(types.indexOf("progress")).toBeLessThan(
			types.indexOf("status:running"),
		);
		expect(result.messages.find((m) => m.type === "progress")).toMatchObject({
			loaded: 5,
			total: 10,
		});
	});

	test("a program that arrives before the runtime reports loading first", async ({
		page,
	}) => {
		const h = await loadFrame(page);
		const result = await run(h, lines("load-delay 300", "out hi"));
		expect(statesOf(result.messages)).toEqual(["loading", "running"]);
	});

	test("an unknown language ends at once with crashed", async ({ page }) => {
		const h = await loadFrame(page);
		const runId = crypto.randomUUID();
		await send(h, {
			type: "run",
			runId,
			language: "fake",
			mode: "script",
			files: { "main.fake": "out x" },
			entry: "missing.fake",
		});
		const result = await collect(h, runId);
		expect(result.exit.reason).toBe("crashed");
	});

	test("a message that does not parse is ignored and the frame lives on", async ({
		page,
	}) => {
		const h = await loadFrame(page);
		await send(h, { type: "run", runId: "not-a-uuid" });
		await send(h, { type: "nonsense" });
		await send(h, { type: "stdin", runId: crypto.randomUUID(), line: 1 });
		expect((await run(h, "out alive")).stdout).toBe("alive\n");
	});
});

for (const [kind, query] of TRANSPORTS) {
	test.describe(`stdin (${kind})`, () => {
		let h: Harness;
		test.beforeEach(async ({ page }) => {
			h = await loadFrame(page, query);
		});

		test("a line typed while the program waits", async () => {
			const id = await start(h, "read");
			await waitFor(h, id, "status", "waiting-input");
			await send(h, { type: "stdin", runId: id, line: "hello" });
			const result = await collect(h, id);
			expect(result.stdout).toBe("hello\n");
			expect(statesOf(result.messages)).toEqual([
				"loading",
				"running",
				"waiting-input",
				"running",
			]);
		});

		test("lines typed before the read are queued in order", async () => {
			const id = await start(h, lines("load-delay 300", "read", "read"));
			await send(h, { type: "stdin", runId: id, line: "one" });
			await send(h, { type: "stdin", runId: id, line: "two" });
			expect((await collect(h, id)).stdout).toBe("one\ntwo\n");
		});

		test("end of input, sticky across reads", async () => {
			const id = await start(h, lines("read", "read", "read"));
			await send(h, { type: "stdin", runId: id, line: "last" });
			await send(h, { type: "stdin-eof", runId: id });
			expect((await collect(h, id)).stdout).toBe("last\nEOF\nEOF\n");
		});

		test("a line over the limit is refused and the run goes on", async () => {
			const id = await start(h, lines("read", "read"));
			await waitFor(h, id, "status", "waiting-input");
			await send(h, {
				type: "stdin",
				runId: id,
				line: "x".repeat(STDIN_LINE_MAX_BYTES + 1),
			});
			await send(h, { type: "stdin", runId: id, line: "ok" });
			await send(h, { type: "stdin", runId: id, line: "ok2" });
			const result = await collect(h, id);
			expect(result.stdout).toBe("ok\nok2\n");
		});

		test("a line of exactly the limit passes", async () => {
			const id = await start(h, "read");
			const line = "y".repeat(STDIN_LINE_MAX_BYTES);
			await send(h, { type: "stdin", runId: id, line });
			expect((await collect(h, id)).stdout).toBe(`${line}\n`);
		});

		test("stop ends a loop in under 2 s and the next run works", async () => {
			const id = await start(h, "loop");
			await waitFor(h, id, "status", "running");
			const before = Date.now();
			await send(h, { type: "stop", runId: id });
			const result = await collect(h, id, 2000);
			expect(Date.now() - before).toBeLessThan(2000);
			expect(result.exit).toMatchObject({ reason: "stopped", code: null });
			expect((await run(h, "out next")).stdout).toBe("next\n");
		});

		test("stop during a read", async () => {
			const id = await start(h, "read");
			await waitFor(h, id, "status", "waiting-input");
			const before = Date.now();
			await send(h, { type: "stop", runId: id });
			const result = await collect(h, id, 2000);
			expect(Date.now() - before).toBeLessThan(2000);
			expect(result.exit.reason).toBe("stopped");
			expect((await run(h, "out next")).stdout).toBe("next\n");
		});
	});
}

test.describe("output limits", () => {
	test.setTimeout(90_000);

	test("flood above maxOutputBytes ends with output-limit", async ({
		page,
	}) => {
		const h = await loadFrame(page);
		const result = await run(h, "flood 5000", "fake", {
			extra: { maxOutputBytes: 1000 },
		});
		expect(result.exit).toMatchObject({ reason: "output-limit", code: null });
		expect((await run(h, "out ok")).stdout).toBe("ok\n");
	});

	test("many small writes under the byte limit hit the message limit", async ({
		page,
	}) => {
		const h = await loadFrame(page);
		const writes = Array.from(
			{ length: OUTPUT_MESSAGES_LIMIT + 500 },
			() => "out a",
		);
		const result = await run(h, writes.join("\n"));
		expect(result.exit).toMatchObject({ reason: "output-limit", code: null });
		expect(result.stdout.length).toBeLessThan(OUTPUT_MESSAGES_LIMIT * 2 + 1);
	});

	test("10 000 writes arrive batched, in order and complete", async ({
		page,
	}) => {
		const h = await loadFrame(page);
		const writes = Array.from({ length: 10_000 }, (_, i) => `out ${i}`);
		const result = await run(h, writes.join("\n"));
		const outputs = result.messages.filter((m) => m.type === "output");
		expect(outputs.length).toBeLessThan(2000);
		expect(result.stdout).toBe(`${writes.map((w) => w.slice(4)).join("\n")}\n`);
		expect(result.exit).toMatchObject({ reason: "exited", code: 0 });
	});

	test("never two equal statuses in a row, and output comes before exit", async ({
		page,
	}) => {
		const h = await loadFrame(page);
		const id = await start(h, lines("out first", "read", "read", "out last"));
		await waitFor(h, id, "status", "waiting-input");
		await send(h, { type: "stdin", runId: id, line: "a" });
		await send(h, { type: "stdin", runId: id, line: "b" });
		const { messages } = await collect(h, id);
		const states = statesOf(messages);
		for (let i = 1; i < states.length; i++) {
			expect(states[i]).not.toBe(states[i - 1]);
		}
		const exitIndex = messages.findIndex((m) => m.type === "exit");
		expect(exitIndex).toBe(messages.length - 1);
		const lastOutput = messages.findLast((m) => m.type === "output");
		expect(lastOutput).toMatchObject({ text: expect.stringContaining("last") });
	});
});

test.describe("forged messages from the Worker", () => {
	test("a forged exit ends the run and nothing after it is relayed", async ({
		page,
	}) => {
		const h = await loadFrame(page);
		const id = await start(
			h,
			`postMessage({ type: "exit", reason: "exited", code: 0 });
			postMessage({ type: "output", stream: "stdout", text: "after" });
			console.log("later");`,
			"javascript",
		);
		const result = await collect(h, id);
		await page.waitForTimeout(300);
		const all = await messagesOf(h, id);
		expect(result.exit).toMatchObject({ reason: "exited", code: 0 });
		expect(all.filter((m) => m.type === "exit")).toHaveLength(1);
		expect(all.at(-1)?.type).toBe("exit");
		expect(JSON.stringify(all)).not.toContain("after");
		expect(JSON.stringify(all)).not.toContain("later");
	});
});

test.describe("concurrency", () => {
	test("with ?exclusive=1 a second concurrent run crashes", async ({
		page,
	}) => {
		const h = await loadFrame(page, "?exclusive=1");
		const first = await start(h, "read");
		await waitFor(h, first, "status", "waiting-input");
		const second = await start(h, "out second");
		const rejected = await collect(h, second);
		expect(rejected.exit.reason).toBe("crashed");
		expect(rejected.stdout).toBe("");
		await send(h, { type: "stdin", runId: first, line: "go" });
		expect((await collect(h, first)).exit).toMatchObject({
			reason: "exited",
			code: 0,
		});
		expect((await run(h, "out third")).stdout).toBe("third\n");
	});

	test("without exclusive two concurrent runs work", async ({ page }) => {
		const h = await loadFrame(page);
		const first = await start(h, "read");
		const second = await start(h, lines("read", "read"));
		await waitFor(h, first, "status", "waiting-input");
		await waitFor(h, second, "status", "waiting-input");
		await send(h, { type: "stdin", runId: second, line: "b1" });
		await send(h, { type: "stdin", runId: first, line: "a1" });
		await send(h, { type: "stdin", runId: second, line: "b2" });
		expect((await collect(h, first)).stdout).toBe("a1\n");
		expect((await collect(h, second)).stdout).toBe("b1\nb2\n");
	});
});

test.describe("status batching", () => {
	test("alternating forged statuses reach the app batched, not one by one", async ({
		page,
	}) => {
		const h = await loadFrame(page);
		const result = await run(
			h,
			`const states = ["waiting-input", "running"];
			for (let i = 0; i < 2000; i++) {
				postMessage({ type: "status", state: states[i % 2] });
			}
			console.log("done");`,
			"javascript",
		);
		const statuses = result.messages.filter((m) => m.type === "status");
		expect(statuses.length).toBeLessThanOrEqual(5);
		expect(result.exit).toMatchObject({ reason: "exited", code: 0 });
	});
});

test.describe("reserve Worker", () => {
	const fakeWorkers = (page: Harness["page"]) => page.workers().length;

	test("prepare then run goes straight to running", async ({ page }) => {
		const h = await loadFrame(page);
		await send(h, { type: "prepare", language: "fake" });
		await expect.poll(() => fakeWorkers(page)).toBe(1);
		await page.waitForTimeout(500); // the reserve finishes its load
		const result = await run(h, "out hi");
		expect(statesOf(result.messages)).toEqual(["running"]);
		expect(result.stdout).toBe("hi\n");
	});

	test("a repeated prepare does not create a second reserve", async ({
		page,
	}) => {
		const h = await loadFrame(page);
		await send(h, { type: "prepare", language: "fake" });
		await send(h, { type: "prepare", language: "fake" });
		await send(h, { type: "prepare", language: "fake" });
		await expect.poll(() => fakeWorkers(page)).toBe(1);
		await page.waitForTimeout(500);
		expect(fakeWorkers(page)).toBe(1);
	});

	test("a prepare for a language the frame did not announce is ignored", async ({
		page,
	}) => {
		const h = await loadFrame(page);
		await send(h, { type: "prepare", language: "haskell" });
		await page.waitForTimeout(500);
		expect(fakeWorkers(page)).toBe(0);
	});

	test("the next reserve waits for the run to end", async ({ page }) => {
		const h = await loadFrame(page);
		await send(h, { type: "prepare", language: "fake" });
		await expect.poll(() => fakeWorkers(page)).toBe(1);
		await page.waitForTimeout(500);
		const id = await start(h, "read");
		await waitFor(h, id, "status", "waiting-input");
		// The run owns the reserve; a prepare now is for the next one.
		expect(fakeWorkers(page)).toBe(1);
		await send(h, { type: "prepare", language: "fake" });
		await page.waitForTimeout(500);
		expect(fakeWorkers(page)).toBe(1);
		await send(h, { type: "stdin", runId: id, line: "x" });
		await collect(h, id);
		await expect.poll(() => fakeWorkers(page)).toBe(1);
		await page.waitForTimeout(500);
		const next = await run(h, "out again");
		expect(statesOf(next.messages)).toEqual(["running"]);
	});

	test("a run that ends leaves no reserve unless the app asked again", async ({
		page,
	}) => {
		const h = await loadFrame(page);
		await send(h, { type: "prepare", language: "fake" });
		await page.waitForTimeout(500);
		await run(h, "out one");
		await page.waitForTimeout(500);
		expect(fakeWorkers(page)).toBe(0);
	});

	test("a hidden document ends the reserves", async ({ page }) => {
		const h = await loadFrame(page);
		await send(h, { type: "prepare", language: "fake" });
		await expect.poll(() => fakeWorkers(page)).toBe(1);
		await h.frame.evaluate(() => {
			Object.defineProperty(document, "visibilityState", {
				get: () => "hidden",
			});
			document.dispatchEvent(new Event("visibilitychange"));
		});
		await expect.poll(() => fakeWorkers(page)).toBe(0);
		// The next run still works, with a fresh Worker.
		expect((await run(h, "out ok")).stdout).toBe("ok\n");
	});
});

test.describe("JavaScript driver", () => {
	test("console.log, console.error and top-level await", async ({ page }) => {
		const h = await loadFrame(page);
		const result = await run(
			h,
			`console.log("a", 1, { x: [1, "two"] });
			console.error("oops");
			console.info("i"); console.warn("w"); console.debug("d");
			const v = await Promise.resolve(42);
			console.log(v);`,
			"javascript",
		);
		expect(result.stdout).toBe("a 1 { x: [ 1, 'two' ] }\ni\nd\n42\n");
		expect(result.stderr).toBe("oops\nw\n");
		expect(result.exit).toMatchObject({ reason: "exited", code: 0 });
	});

	test("prompt reads a line", async ({ page }) => {
		const h = await loadFrame(page);
		const id = await start(
			h,
			`const name = prompt("name? ");
			console.log("hi " + name);`,
			"javascript",
		);
		await waitFor(h, id, "status", "waiting-input");
		await send(h, { type: "stdin", runId: id, line: "Ana" });
		const result = await collect(h, id);
		expect(result.stdout).toBe("name? hi Ana\n");
	});

	test("an uncaught exception prints its stack and exits with 1", async ({
		page,
	}) => {
		const h = await loadFrame(page);
		const result = await run(h, `console.log("before"); null.x;`, "javascript");
		expect(result.stdout).toBe("before\n");
		expect(result.stderr).toContain("TypeError");
		expect(result.exit).toMatchObject({ reason: "exited", code: 1 });
	});

	test("a syntax error points at its line and column and exits with 1", async ({
		page,
	}) => {
		const h = await loadFrame(page);
		const result = await run(
			h,
			"let sum = 0;\nfunction add(n: number) {}\n",
			"javascript",
		);
		expect(result.stderr).toMatch(
			/^main\.js:2:15\nfunction add\(n: number\) \{\}\n {14}\^\n\nSyntaxError: /,
		);
		expect(result.exit).toMatchObject({
			reason: "exited",
			code: 1,
			diagnostics: [
				{
					file: "main.js",
					line: 2,
					column: 14,
					message: expect.stringMatching(/^SyntaxError: /),
				},
			],
		});
	});

	test("pending timers keep the script alive", async ({ page }) => {
		const h = await loadFrame(page);
		const result = await run(
			h,
			`setTimeout(() => console.log("later"), 100); console.log("now");`,
			"javascript",
		);
		expect(result.stdout).toBe("now\nlater\n");
	});

	test("the REPL evaluates lines in a shared scope until end of input", async ({
		page,
	}) => {
		const h = await loadFrame(page);
		const id = await start(h, "", "javascript", { mode: "repl" });
		await waitFor(h, id, "status", "waiting-input");
		await send(h, { type: "stdin", runId: id, line: "var x = 20" });
		await send(h, { type: "stdin", runId: id, line: "x + 22" });
		await send(h, { type: "stdin", runId: id, line: "nope()" });
		await send(h, { type: "stdin", runId: id, line: "'s'" });
		await send(h, { type: "stdin-eof", runId: id });
		const result = await collect(h, id);
		expect(result.stdout).toBe("42\n's'\n");
		expect(result.stderr).toContain("ReferenceError");
		expect(result.exit).toMatchObject({ reason: "exited", code: 0 });
	});
});

/// Stops the runner's service worker, as the browser does when it is idle: it
/// restarts on the next request with no state.
async function stopServiceWorker(page: Page): Promise<void> {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("ServiceWorker.enable");
	await cdp.send("ServiceWorker.stopAllWorkers");
	await cdp.detach();
}

test.describe("service worker restarted during a run (sw transport)", () => {
	test.skip(
		({ browserName }) => browserName !== "chromium",
		"stopping the service worker needs the Chromium DevTools protocol",
	);
	test.setTimeout(60_000);

	const SLEEP_THEN_PROMPT = `await new Promise((r) => setTimeout(r, 2500));
		console.log("got:" + prompt());`;

	test("the run keeps its channel and the queued line", async ({ page }) => {
		const h = await loadFrame(page, "?isolation=off");
		const id = await start(h, SLEEP_THEN_PROMPT, "javascript");
		await waitFor(h, id, "status", "running");
		await send(h, { type: "stdin", runId: id, line: "kept" });
		await stopServiceWorker(page);
		const result = await collect(h, id, 20_000);
		expect(result.stdout).toBe("got:kept\n");
		expect(result.exit).toMatchObject({ reason: "exited", code: 0 });
	});

	test("when the frame cannot rebuild the channel the run crashes instead of hanging", async ({
		page,
	}) => {
		const h = await loadFrame(page, "?isolation=off");
		await h.frame.evaluate(() => {
			navigator.serviceWorker.addEventListener = () => {};
		});
		const id = await start(h, SLEEP_THEN_PROMPT, "javascript");
		await waitFor(h, id, "status", "running");
		await stopServiceWorker(page);
		const result = await collect(h, id, 20_000);
		expect(result.exit).toMatchObject({ reason: "crashed", code: null });
		expect(result.exit.message).toContain("stdin");
	});

	test("a REPL whose channel is lost ends with crashed", async ({ page }) => {
		const h = await loadFrame(page, "?isolation=off");
		await h.frame.evaluate(() => {
			navigator.serviceWorker.addEventListener = () => {};
		});
		const id = await start(h, "", "javascript", { mode: "repl" });
		await waitFor(h, id, "status", "waiting-input");
		await stopServiceWorker(page);
		await send(h, { type: "stdin", runId: id, line: "prompt()" });
		const result = await collect(h, id, 20_000);
		expect(result.exit).toMatchObject({ reason: "crashed", code: null });
	});
});

test.describe("Worker output is cut inside the Worker", () => {
	test("a huge print posts at most the budget to the frame", async ({
		page,
	}) => {
		const h = await loadFrame(page);
		await h.frame.evaluate(() => {
			const w = window as unknown as { __maxText: number };
			w.__maxText = 0;
			const Original = window.Worker;
			window.Worker = class extends Original {
				constructor(url: string | URL, options?: WorkerOptions) {
					super(url, options);
					this.addEventListener("message", (event) => {
						const text = event.data?.text;
						if (typeof text === "string") {
							w.__maxText = Math.max(w.__maxText, text.length);
						}
					});
				}
			};
		});
		const result = await run(
			h,
			'console.log("x".repeat(50_000_000));',
			"javascript",
			{ extra: { maxOutputBytes: 1000 } },
		);
		expect(result.exit).toMatchObject({ reason: "output-limit", code: null });
		const max = await h.frame.evaluate(
			() => (window as unknown as { __maxText: number }).__maxText,
		);
		expect(max).toBeLessThanOrEqual(2000);
	});
});

test.describe("bundle served no more", () => {
	const WORKER = "**/runner/*/worker.js";

	test("a run whose Worker script is 404 exits stale-bundle", async ({
		page,
	}) => {
		const h = await loadFrame(page);
		await page.route(WORKER, (route) => route.fulfill({ status: 404 }));
		const result = await run(h, "out hi");
		expect(result.exit).toMatchObject({ reason: "stale-bundle", code: null });
		expect(result.exit.message).toBeTruthy();
	});

	test("a cached Worker script with a 404 driver chunk exits stale-bundle", async ({
		page,
	}) => {
		const h = await loadFrame(page);
		let workerRequests = 0;
		// The first request is the Worker itself (served from the HTTP cache in
		// the field); later ones are the frame's own check, which reaches the server.
		await page.route(WORKER, (route) =>
			++workerRequests === 1
				? route.continue()
				: route.fulfill({ status: 404 }),
		);
		await page.route(/\/runner\/[^/]+\/javascript-[^/]+\.js$/, (route) =>
			route.fulfill({ status: 404 }),
		);
		const result = await run(h, "out hi", "javascript");
		expect(result.exit).toMatchObject({ reason: "stale-bundle", code: null });
	});

	test("another failure of the Worker stays load-failed", async ({ page }) => {
		const h = await loadFrame(page);
		await page.route(WORKER, (route) => route.fulfill({ status: 500 }));
		const result = await run(h, "out hi");
		expect(result.exit.reason).toBe("load-failed");
	});

	test("a reserve with the same failure tells the app", async ({ page }) => {
		const h = await loadFrame(page);
		await page.route(WORKER, (route) => route.fulfill({ status: 404 }));
		await send(h, { type: "prepare", language: "fake" });
		await page.waitForFunction(() =>
			(
				window as unknown as { __runnerMessages: { type: string }[] }
			).__runnerMessages.some((m) => m.type === "stale-bundle"),
		);
	});
});

test.describe("stdin channel table: resync", () => {
	const TOKEN = "11111111-1111-4111-8111-111111111111";
	const RUN = "22222222-2222-4222-8222-222222222222";

	test("a request without a token for an unknown channel gets 403 with no resync", async () => {
		const channels = new StdinChannels();
		let resyncs = 0;
		const reply = await channels.read(RUN, null, "worker", () => resyncs++);
		expect(reply.status).toBe(403);
		expect(resyncs).toBe(0);
	});

	test("a malformed token for an unknown channel gets 403 with no resync", async () => {
		const channels = new StdinChannels();
		let resyncs = 0;
		const reply = await channels.read(RUN, "x", "worker", () => resyncs++);
		expect(reply.status).toBe(403);
		expect(resyncs).toBe(0);
	});

	test("concurrent requests for the same unknown run cause one resync", async () => {
		const channels = new StdinChannels();
		let resyncs = 0;
		const first = channels.read(RUN, TOKEN, "worker", () => resyncs++);
		const second = channels.read(RUN, TOKEN, "worker", () => resyncs++);
		channels.open(RUN, TOKEN, "frame", ["a"]);
		expect(resyncs).toBe(1);
		const replies = await Promise.all([first, second]);
		expect(replies.map((r) => r.status)).toEqual([200, 204]);
	});

	test("an expired resync answers 410 marked as retryable", async () => {
		const channels = new StdinChannels();
		const reply = await channels.read(RUN, TOKEN, "worker", () => {});
		expect(reply).toMatchObject({ status: 410, retry: true });
	});

	test("a cancelled channel answers 410 that is not retryable", async () => {
		const channels = new StdinChannels();
		channels.open(RUN, TOKEN, "frame");
		const pending = channels.read(RUN, TOKEN, "worker");
		channels.cancel(RUN, "frame");
		const reply = await pending;
		expect(reply.status).toBe(410);
		expect(reply.retry).toBeUndefined();
	});

	test("acknowledges consumed lines to the owner only when they advance", () => {
		const channels = new StdinChannels();
		channels.open(RUN, TOKEN, "frame");
		expect(channels.ack(RUN, "bad", 3)).toBeNull();
		expect(channels.ack(RUN, TOKEN, 0)).toBeNull();
		expect(channels.ack(RUN, TOKEN, 3)).toBe("frame");
		expect(channels.ack(RUN, TOKEN, 3)).toBeNull();
		expect(channels.ack(RUN, TOKEN, 4)).toBe("frame");
	});
});

test.describe("service worker restarted while the frame is busy (sw transport)", () => {
	test.skip(
		({ browserName }) => browserName !== "chromium",
		"stopping the service worker needs the Chromium DevTools protocol",
	);
	test.setTimeout(60_000);

	test("the Worker retries after a resync that expired", async ({ page }) => {
		const h = await loadFrame(page, "?isolation=off");
		const id = await start(
			h,
			`await new Promise((r) => setTimeout(r, 2500));
			console.log("got:" + prompt());`,
			"javascript",
		);
		await waitFor(h, id, "status", "running");
		await send(h, { type: "stdin", runId: id, line: "kept" });
		await stopServiceWorker(page);
		// Keep the frame's main thread busy past the old 1 s resync deadline.
		void h.frame.evaluate(() => {
			const end = Date.now() + 4000;
			while (Date.now() < end);
		});
		const result = await collect(h, id, 30_000);
		expect(result.stdout).toBe("got:kept\n");
		expect(result.exit).toMatchObject({ reason: "exited", code: 0 });
	});

	test("lines consumed before the restart are not replayed", async ({
		page,
	}) => {
		const h = await loadFrame(page, "?isolation=off");
		const id = await start(
			h,
			`const a = prompt();
			await new Promise((r) => setTimeout(r, 2500));
			console.log(a + "," + prompt());`,
			"javascript",
		);
		await waitFor(h, id, "status", "running");
		await send(h, { type: "stdin", runId: id, line: "one" });
		await page.waitForTimeout(800);
		await send(h, { type: "stdin", runId: id, line: "two" });
		await stopServiceWorker(page);
		const result = await collect(h, id, 30_000);
		expect(result.stdout).toBe("one,two\n");
	});

	test("the frame is told how many lines the Worker consumed", async ({
		page,
	}) => {
		const h = await loadFrame(page, "?isolation=off");
		await h.frame.evaluate(() => {
			const w = window as unknown as { __consumed: number[] };
			w.__consumed = [];
			navigator.serviceWorker.addEventListener("message", (event) => {
				if (event.data?.type === "stdin-consumed") {
					w.__consumed.push(event.data.consumed);
				}
			});
		});
		const id = await start(
			h,
			`prompt(); prompt(); console.log("done");`,
			"javascript",
		);
		await send(h, { type: "stdin", runId: id, line: "a" });
		await send(h, { type: "stdin", runId: id, line: "b" });
		await collect(h, id, 20_000);
		const seen = await h.frame.evaluate(
			() => (window as unknown as { __consumed: number[] }).__consumed,
		);
		expect(Math.max(...seen)).toBeGreaterThanOrEqual(1);
	});
});
