import { expect, type Page, test } from "@playwright/test";
import type { RunnerHost, RunnerUnavailable } from "@/runner/host";
import { TEST_RUNNER_ORIGIN } from "./env";

/**
 * `RunnerHost` through the diagnostic page, which exposes the class on
 * `window.__runner`. Scenarios that need several runs, a second host or a
 * bogus runner origin drive the class from `page.evaluate`; the page's own
 * controls are exercised through the DOM.
 */

interface RunnerGlobals {
	RunnerHost: typeof RunnerHost;
	RunnerUnavailable: typeof RunnerUnavailable;
}

declare global {
	interface Window {
		__runner: RunnerGlobals;
	}
}

/// A port nothing listens on: the iframe loads an error page and never says `ready`.
const DEAD_ORIGIN = "http://127.0.0.1:9";

async function openPage(page: Page) {
	await page.goto("/design/runner");
	await expect(page.locator("#transport")).not.toHaveText("connecting…");
}

const frames = (page: Page) => page.locator("iframe[data-runner-frame]");

test.describe("page controls", () => {
	test("run prints the program output", async ({ page }) => {
		await openPage(page);
		await page.locator("#code").fill('console.log("hi", 1 + 1)');
		await page.locator("#run").click();
		await expect(page.locator("#output")).toHaveText("hi 2\n");
		await expect(page.locator("#exit")).toHaveText(/exited \(code 0\)/);
		await expect(page.locator("#transport")).toHaveText(/^(sab|sw)$/);
	});

	test("stdin lines reach the program", async ({ page }) => {
		await openPage(page);
		await page.locator("#language").selectOption("fake");
		await page.locator("#code").fill("read\nread");
		await page.locator("#run").click();
		await expect(page.locator("#stdin")).toBeEnabled();
		await page.locator("#stdin").fill("one");
		await page.locator("#send").click();
		await page.locator("#eof").click();
		await expect(page.locator("#output")).toHaveText("one\nEOF\n");
	});

	test("stop ends the run as stopped", async ({ page }) => {
		await openPage(page);
		await page.locator("#language").selectOption("fake");
		await page.locator("#code").fill("loop");
		await page.locator("#run").click();
		await expect(page.locator("#stop")).toBeEnabled();
		await expect(page.locator("#status")).toHaveText("running");
		await page.locator("#stop").click();
		await expect(page.locator("#exit")).toHaveText("stopped");
		await expect(page.locator("#run")).toBeEnabled();
	});

	test("a run before the reserve is ready shows preparando…", async ({
		page,
	}) => {
		await openPage(page);
		await page.locator("#language").selectOption("fake");
		await page.locator("#code").fill("load-delay 1500\nout x");
		await page.locator("#run").click();
		await expect(page.locator("#status")).toHaveText("preparando…");
		await expect(page.locator("#exit")).toHaveText(/exited/);
	});

	test("the first focus of the editor prepares a reserve, page load does not", async ({
		page,
	}) => {
		await openPage(page);
		await page.locator("#language").selectOption("fake");
		await page.waitForTimeout(500);
		expect(page.workers()).toHaveLength(0);
		await page.locator("#code").focus();
		await expect.poll(() => page.workers().length).toBe(1);
	});
});

test.describe("RunnerHost", () => {
	test("two shared hosts use one iframe", async ({ page }) => {
		await openPage(page);
		const same = await page.evaluate(async (origin) => {
			const { RunnerHost } = window.__runner;
			const a = RunnerHost.shared(origin);
			const b = RunnerHost.shared(origin);
			await Promise.all([a.ready(), b.ready()]);
			return a === b;
		}, TEST_RUNNER_ORIGIN);
		expect(same).toBe(true);
		await expect(frames(page)).toHaveCount(1);
	});

	test("reload replaces the iframe and stops the run in progress", async ({
		page,
	}) => {
		await openPage(page);
		const result = await page.evaluate(async (origin) => {
			const host = window.__runner.RunnerHost.shared(origin);
			const before = document.querySelector("iframe[data-runner-frame]");
			const run = await host.run(
				{
					language: "fake",
					mode: "script",
					files: { "main.fake": "loop" },
					entry: "main.fake",
				},
				{},
			);
			await host.reload();
			const exit = await run.done;
			const after = document.querySelector("iframe[data-runner-frame]");
			return { exit: exit.reason, replaced: before !== after };
		}, TEST_RUNNER_ORIGIN);
		expect(result).toEqual({ exit: "stopped", replaced: true });
		await expect(frames(page)).toHaveCount(1);
	});

	test("exclusive has its own iframe and a new run stops the previous one", async ({
		page,
	}) => {
		await openPage(page);
		const result = await page.evaluate(async (origin) => {
			const { RunnerHost } = window.__runner;
			await RunnerHost.shared(origin).ready();
			const host = RunnerHost.exclusive(origin);
			await host.ready();
			const request = (source: string) => ({
				language: "fake" as const,
				mode: "script" as const,
				files: { "main.fake": source },
				entry: "main.fake",
			});
			const first = await host.run(request("loop"), {});
			let out = "";
			const second = await host.run(request("out two"), {
				onOutput: (_, text) => {
					out += text;
				},
			});
			return {
				first: (await first.done).reason,
				second: (await second.done).reason,
				out,
				srcs: [...document.querySelectorAll("iframe[data-runner-frame]")].map(
					(f) => (f as HTMLIFrameElement).src,
				),
			};
		}, TEST_RUNNER_ORIGIN);
		expect(result.first).toBe("stopped");
		expect(result.second).toBe("exited");
		expect(result.out).toBe("two\n");
		expect(result.srcs.sort()).toEqual([
			`${TEST_RUNNER_ORIGIN}/runner/frame`,
			`${TEST_RUNNER_ORIGIN}/runner/frame?exclusive=1`,
		]);
	});

	test("a message forged by the page itself is ignored", async ({ page }) => {
		await openPage(page);
		const result = await page.evaluate(async (origin) => {
			const host = window.__runner.RunnerHost.shared(origin);
			let out = "";
			const run = await host.run(
				{
					language: "fake",
					mode: "script",
					files: { "main.fake": "read" },
					entry: "main.fake",
				},
				{
					onOutput: (_, text) => {
						out += text;
					},
				},
			);
			for (const message of [
				{ type: "output", runId: run.runId, stream: "stdout", text: "forged" },
				{ type: "exit", runId: run.runId, reason: "exited", code: 0 },
			]) {
				window.postMessage(message, "*");
			}
			const settled = await Promise.race([
				run.done.then(() => true),
				new Promise<boolean>((resolve) => setTimeout(resolve, 500, false)),
			]);
			run.stop();
			return { settled, out, exit: (await run.done).reason };
		}, TEST_RUNNER_ORIGIN);
		expect(result).toEqual({ settled: false, out: "", exit: "stopped" });
	});

	test("a frame that never says ready gives RunnerUnavailable timeout", async ({
		page,
	}) => {
		await openPage(page);
		await page.clock.install();
		const pending = page.evaluate(async (origin) => {
			try {
				await window.__runner.RunnerHost.shared(origin).ready();
				return "ready";
			} catch (error) {
				const { RunnerUnavailable } = window.__runner;
				return error instanceof RunnerUnavailable ? error.reason : "other";
			}
		}, DEAD_ORIGIN);
		await page.clock.runFor(16_000);
		expect(await pending).toBe("timeout");
	});

	test("prepare with an unavailable runner does not throw", async ({
		page,
	}) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await openPage(page);
		await page.clock.install();
		const threw = await page.evaluate((origin) => {
			try {
				window.__runner.RunnerHost.shared(origin).prepare("fake");
				return false;
			} catch {
				return true;
			}
		}, DEAD_ORIGIN);
		await page.clock.runFor(16_000);
		expect(threw).toBe(false);
		expect(errors).toEqual([]);
	});

	test("prepare before run starts the run without loading", async ({
		page,
	}) => {
		await openPage(page);
		const states = await page.evaluate(async (origin) => {
			const host = window.__runner.RunnerHost.shared(origin);
			host.prepare("fake");
			await new Promise((resolve) => setTimeout(resolve, 1000));
			const seen: string[] = [];
			const run = await host.run(
				{
					language: "fake",
					mode: "script",
					files: { "main.fake": "out hi" },
					entry: "main.fake",
				},
				{ onStatus: (state) => seen.push(state) },
			);
			await run.done;
			return seen;
		}, TEST_RUNNER_ORIGIN);
		expect(states).toEqual(["running"]);
	});
});
