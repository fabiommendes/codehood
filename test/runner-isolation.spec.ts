import { randomUUID } from "node:crypto";
import type { RunnerToAppMessage } from "@codehood/runner/protocol";
import { TEST_BASE_URL, TEST_RUNNER_ORIGIN } from "./env";
import { expect, type Frame, type Page, test } from "./fixtures";
import { logInAs, seedUser } from "./stories/helpers";

/**
 * Isolation of the runner origin as the app serves it: the session cookie and
 * the app's routes stay out of the runner's reach. The rest of the isolation
 * is tested in `packages/runner/test/isolation.spec.ts`.
 */

interface RunnerWindow extends Window {
	__runnerMessages: Record<string, unknown>[];
}

/// A frame loaded into an app page, plus the page that hosts it.
interface Harness {
	page: Page;
	frame: Frame;
	query: string;
}

/**
 * Loads (or replaces) the runner iframe of `page` and waits for its `ready`.
 *
 * The page keeps every message the frame posts, as the app side of the
 * protocol would see it: only those whose origin and source are the frame's.
 */
async function loadFrame(
	page: Page,
	query = "",
	{ navigate = true }: { navigate?: boolean } = {},
): Promise<Harness> {
	if (navigate) {
		await page.goto("/login");
	}
	await page.evaluate(
		({ origin, query }) => {
			const w = window as unknown as RunnerWindow;
			document.getElementById("runner-frame")?.remove();
			w.__runnerMessages = [];
			const iframe = document.createElement("iframe");
			iframe.id = "runner-frame";
			window.addEventListener("message", (event) => {
				if (event.origin === origin && event.source === iframe.contentWindow) {
					w.__runnerMessages.push(event.data);
				}
			});
			iframe.src = `${origin}/runner/frame${query}`;
			document.body.append(iframe);
		},
		{ origin: TEST_RUNNER_ORIGIN, query },
	);
	await page.waitForFunction(
		() =>
			(window as unknown as RunnerWindow).__runnerMessages.some(
				(m) => m.type === "ready",
			),
		undefined,
		{ timeout: 20_000 },
	);
	const handle = await page.locator("#runner-frame").elementHandle();
	const frame = await handle?.contentFrame();
	if (!frame) throw new Error("runner frame did not attach");
	return { page, frame, query };
}

/** Posts a raw protocol message to the frame, as the app does. */
async function send(h: Harness, message: Record<string, unknown>) {
	await h.page.evaluate(
		({ message, origin }) => {
			const iframe = document.getElementById(
				"runner-frame",
			) as HTMLIFrameElement;
			iframe.contentWindow?.postMessage(message, origin);
		},
		{ message, origin: TEST_RUNNER_ORIGIN },
	);
}

/** Everything the frame posted so far for `runId`. */
async function messagesOf(
	h: Harness,
	runId: string,
): Promise<RunnerToAppMessage[]> {
	return (await h.page.evaluate(
		(id) =>
			(window as unknown as RunnerWindow).__runnerMessages.filter(
				(m) => m.runId === id,
			),
		runId,
	)) as RunnerToAppMessage[];
}

async function waitFor(
	h: Harness,
	runId: string,
	type: "exit" | "status",
	state?: string,
	timeout = 30_000,
) {
	await h.page.waitForFunction(
		({ id, type, state }) =>
			(window as unknown as RunnerWindow).__runnerMessages.some(
				(m) =>
					m.runId === id && m.type === type && (!state || m.state === state),
			),
		{ id: runId, type, state },
		{ timeout },
	);
}

interface RunResult {
	runId: string;
	stdout: string;
	stderr: string;
	exit: Extract<RunnerToAppMessage, { type: "exit" }>;
	messages: RunnerToAppMessage[];
}

function runMessage(
	runId: string,
	code: string,
	language: "javascript" | "fake" = "javascript",
) {
	const entry = language === "javascript" ? "main.js" : "main.fake";
	return {
		type: "run",
		runId,
		language,
		mode: "script",
		files: { [entry]: code },
		entry,
	};
}

/** Starts a run without waiting for it. */
async function start(
	h: Harness,
	code: string,
	language: "javascript" | "fake" = "javascript",
	runId = randomUUID(),
) {
	await send(h, runMessage(runId, code, language));
	return runId;
}

/** Collects the finished run `runId` from the messages the page saw. */
async function collect(h: Harness, runId: string): Promise<RunResult> {
	await waitFor(h, runId, "exit");
	const messages = await messagesOf(h, runId);
	const text = (stream: string) =>
		messages
			.filter((m) => m.type === "output" && m.stream === stream)
			.map((m) => (m as { text: string }).text)
			.join("");
	const exit = messages.find((m) => m.type === "exit") as RunResult["exit"];
	return {
		runId,
		stdout: text("stdout"),
		stderr: text("stderr"),
		exit,
		messages,
	};
}

async function run(
	h: Harness,
	code: string,
	language: "javascript" | "fake" = "javascript",
): Promise<RunResult> {
	return collect(h, await start(h, code, language));
}

/**
 * Runs `code` in the JavaScript driver and returns what it logged as JSON.
 * The code must `console.log(JSON.stringify(value))` as its last output.
 */
async function probe<T>(h: Harness, code: string): Promise<T> {
	const result = await run(h, code);
	expect(
		{
			reason: result.exit.reason,
			code: result.exit.code,
			stderr: result.stderr,
		},
		"the probe itself must run to completion",
	).toEqual({ reason: "exited", code: 0, stderr: "" });
	const lines = result.stdout.trim().split("\n");
	return JSON.parse(lines[lines.length - 1] ?? "null") as T;
}

test.describe("network reach of a run", () => {
	test("the session cookie never reaches the runner origin", async ({
		page,
		context,
	}) => {
		const user = await seedUser();
		await logInAs(page, user);
		const seen: { url: string; cookie: string | undefined }[] = [];
		context.on("request", async (request) => {
			const headers = await request.allHeaders();
			seen.push({ url: request.url(), cookie: headers.cookie });
		});

		const h = await loadFrame(page);
		const result = await run(
			h,
			`const a = await fetch("/runner/frame");
			const b = await fetch("/login");
			console.log(JSON.stringify([a.status, b.status]));`,
		);
		expect(result.exit.reason).toBe("exited");
		await page.waitForTimeout(300); // let late request listeners settle

		const toRunner = seen.filter((r) => r.url.startsWith(TEST_RUNNER_ORIGIN));
		expect(
			toRunner.length,
			"frame, worker script and fetches must have been observed",
		).toBeGreaterThanOrEqual(3);
		expect(toRunner.filter((r) => r.cookie)).toEqual([]);
		expect(await context.cookies(TEST_RUNNER_ORIGIN)).toEqual([]);

		const toApp = seen.filter((r) => r.url.startsWith(TEST_BASE_URL));
		expect(
			toApp.some((r) => r.cookie?.includes("session=")),
			"control: the logged-in app page does send its cookie to the app",
		).toBe(true);
	});

	test("fetch from a Worker to the runner origin outside /runner/ is 404", async ({
		page,
	}) => {
		const h = await loadFrame(page);
		const statuses = await probe<Record<string, number>>(
			h,
			`const out = {};
			for (const path of ["/login", "/api/auth/me", "/runner", "/"]) {
				out[path] = (await fetch(path)).status;
			}
			console.log(JSON.stringify(out));`,
		);
		expect(statuses).toEqual({
			"/login": 404,
			"/api/auth/me": 404,
			"/runner": 404,
			"/": 404,
		});
	});
});
