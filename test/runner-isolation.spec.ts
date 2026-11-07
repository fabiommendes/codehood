import { randomUUID } from "node:crypto";
import {
	type BrowserContext,
	expect,
	type Frame,
	type Page,
	test,
} from "@playwright/test";
import {
	OUTPUT_MESSAGES_LIMIT,
	type RunnerToAppMessage,
} from "@/runner/protocol";
import { SW_STDIN_PATH } from "@/runner/sandbox/stdin/types";
import { TEST_BASE_URL, TEST_RUNNER_ORIGIN } from "./env";
import { logInAs, seedUser } from "./stories/helpers";

/**
 * Isolation of the runner origin: what student code running in a run's Worker
 * can and cannot reach. The Worker runs the real JavaScript driver in the real
 * frame; the app page drives the frame with raw protocol messages.
 */

/// Origin that is neither the app nor the runner, served by `context.route`.
const OTHER_ORIGIN = "http://attacker.test";

/// Names `lockDownWorkerScope` removes from `self`.
const LOCKED_GLOBALS = [
	"indexedDB",
	"caches",
	"Worker",
	"SharedWorker",
	"BroadcastChannel",
];

interface RunnerWindow extends Window {
	__runnerMessages: Record<string, unknown>[];
}

/// A frame loaded into an app page, plus the page that hosts it.
interface Harness {
	page: Page;
	frame: Frame;
	query: string;
}

type ForgedSender = (message: Record<string, unknown>) => Promise<void>;

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

/// What the origin of the frame keeps, seen from the frame's own document.
interface OriginStorage {
	databases: (string | undefined)[];
	caches: string[];
	opfs: string[];
}

async function originStorage(frame: Frame): Promise<OriginStorage> {
	return frame.evaluate(async () => {
		const databases = (await indexedDB.databases()).map((d) => d.name);
		const caches_ = await caches.keys();
		const root = (await navigator.storage.getDirectory()) as unknown as {
			keys(): AsyncIterable<string>;
		};
		const opfs: string[] = [];
		for await (const name of root.keys()) opfs.push(name);
		return { databases, caches: caches_, opfs };
	});
}

async function plantInOrigin(frame: Frame) {
	await frame.evaluate(async () => {
		await new Promise<void>((resolve, reject) => {
			const open = indexedDB.open("planted");
			open.onupgradeneeded = () => open.result.createObjectStore("s");
			open.onsuccess = () => {
				open.result.close();
				resolve();
			};
			open.onerror = () => reject(open.error);
		});
		await (await caches.open("planted")).put("/x", new Response("x"));
		const root = await navigator.storage.getDirectory();
		await root.getFileHandle("planted.txt", { create: true });
	});
}

const EMPTY_STORAGE: OriginStorage = { databases: [], caches: [], opfs: [] };

/** Registers the cross-origin page used by the hostile windows. */
async function serveOtherOrigin(context: BrowserContext) {
	await context.route(`${OTHER_ORIGIN}/**`, (route) =>
		route.fulfill({
			contentType: "text/html",
			body: "<!doctype html><title>other</title><body></body>",
		}),
	);
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

	test("fetch from a Worker to the app API fails, however it is made", async ({
		page,
		context,
	}) => {
		const apiResponses: string[] = [];
		context.on("response", (response) => {
			if (response.url().startsWith(`${TEST_BASE_URL}/api/`)) {
				apiResponses.push(response.url());
			}
		});
		const h = await loadFrame(page);
		const outcome = await probe<Record<string, string>>(
			h,
			`const url = ${JSON.stringify(`${TEST_BASE_URL}/api/auth/me`)};
			const out = {};
			const attempt = async (name, fn) => {
				try { out[name] = "ok:" + (await fn()); } catch (e) { out[name] = "blocked"; }
			};
			await attempt("fetch", async () => (await fetch(url)).status);
			await attempt("credentials", async () => (await fetch(url, { credentials: "include" })).status);
			await attempt("no-cors", async () => (await fetch(url, { mode: "no-cors" })).type);
			await attempt("xhr", async () => {
				const x = new XMLHttpRequest();
				x.open("GET", url, false);
				x.send();
				return x.status;
			});
			console.log(JSON.stringify(out));`,
		);
		expect(outcome).toEqual({
			fetch: "blocked",
			credentials: "blocked",
			"no-cors": "blocked",
			xhr: "blocked",
		});
		expect(apiResponses).toEqual([]);
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

test.describe("the Worker scope is locked down", () => {
	test("blocked APIs are undefined and immune to assignment and delete", async ({
		page,
	}) => {
		const h = await loadFrame(page);
		const report = await probe<Record<string, Record<string, unknown>>>(
			h,
			`const report = {};
			const targets = [
				["self", self, ${JSON.stringify(LOCKED_GLOBALS)}],
				["navigator", navigator, ["storage", "serviceWorker", "locks"]],
			];
			for (const [label, root, names] of targets) {
				for (const name of names) {
					const before = typeof root[name];
					try { root[name] = { fake: true }; } catch {}
					try { delete root[name]; } catch {}
					try { Object.defineProperty(root, name, { value: { fake: true } }); } catch {}
					const d = Object.getOwnPropertyDescriptor(root, name);
					report[label + "." + name] = {
						before,
						after: typeof root[name],
						writable: d?.writable,
						configurable: d?.configurable,
						value: d?.value === undefined ? "undefined" : "defined",
					};
				}
			}
			console.log(JSON.stringify(report));`,
		);
		const expected = {
			before: "undefined",
			after: "undefined",
			writable: false,
			configurable: false,
			value: "undefined",
		};
		for (const name of LOCKED_GLOBALS) {
			expect(report[`self.${name}`], name).toEqual(expected);
		}
		for (const name of ["storage", "serviceWorker", "locks"]) {
			expect(report[`navigator.${name}`], name).toEqual(expected);
		}
	});

	test("no API comes back through the prototype chain", async ({ page }) => {
		const h = await loadFrame(page);
		const report = await probe<{
			leaks: string[];
			inPrototypes: string[];
			selfChain: number;
			navigatorChain: number;
		}>(
			h,
			`const GLOBALS = ${JSON.stringify(LOCKED_GLOBALS)};
			const NAV = ["storage", "serviceWorker", "locks"];
			const chain = (o) => {
				const r = [];
				for (let p = o; p; p = Object.getPrototypeOf(p)) r.push(p);
				return r;
			};
			const leaks = [];
			const inPrototypes = [];
			const scan = (label, root, names) => {
				const objects = chain(root);
				for (const [i, p] of objects.entries()) {
					for (const n of names) {
						const d = Object.getOwnPropertyDescriptor(p, n);
						if (!d) continue;
						if (i > 0) inPrototypes.push(label + "." + n);
						let v = d.value;
						if (d.get) { try { v = d.get.call(root); } catch {} }
						if (v !== undefined) leaks.push(label + "." + n);
					}
				}
				return objects.length;
			};
			const selfChain = scan("self", self, GLOBALS);
			const navigatorChain = scan("navigator", navigator, NAV);
			console.log(JSON.stringify({ leaks, inPrototypes, selfChain, navigatorChain }));`,
		);
		expect(
			report.selfChain,
			"the chain must have been walked",
		).toBeGreaterThanOrEqual(3);
		expect(report.navigatorChain).toBeGreaterThanOrEqual(2);
		expect(report.leaks).toEqual([]);
		expect(report.inPrototypes).toEqual([]);
	});

	test("no Worker can be created from a run, Blob URL included", async ({
		page,
	}) => {
		const h = await loadFrame(page);
		const report = await probe<Record<string, string>>(
			h,
			`const out = {};
			const blob = new Blob(["self.__seen = [typeof indexedDB, typeof caches, typeof Worker].join()"], { type: "text/javascript" });
			const url = URL.createObjectURL(blob);
			const creators = {
				direct: () => new Worker(url),
				viaSelf: () => new self.Worker(url),
				computedName: () => new globalThis["Wor" + "ker"](url),
				shared: () => new SharedWorker(url),
				module: () => new Worker(url, { type: "module" }),
				dataUrl: () => new Worker("data:text/javascript,postMessage(1)"),
				sameOrigin: () => new Worker("/runner/frame"),
			};
			for (const [name, create] of Object.entries(creators)) {
				try { create().terminate?.(); out[name] = "created"; } catch { out[name] = "blocked"; }
			}
			try { importScripts(url); out.importScripts = self.__seen; } catch { out.importScripts = "blocked"; }
			try { await import(url); out.import = self.__seen; } catch { out.import = "blocked"; }
			console.log(JSON.stringify(out));`,
		);
		for (const name of [
			"direct",
			"viaSelf",
			"computedName",
			"shared",
			"module",
			"dataUrl",
			"sameOrigin",
		]) {
			expect(report[name], name).toBe("blocked");
		}
		// Code that runs in this very global still sees the locked scope.
		for (const name of ["importScripts", "import"]) {
			expect(["blocked", "undefined,undefined,undefined"], name).toContain(
				report[name],
			);
		}
	});

	for (const [label, query] of [
		["sab", ""],
		["sw", "?isolation=off"],
	] as const) {
		test(`a Worker cannot register or update a service worker (${label})`, async ({
			page,
		}) => {
			const h = await loadFrame(page, query);
			const registrations = () =>
				h.frame.evaluate(async () =>
					(await navigator.serviceWorker.getRegistrations()).map((r) => ({
						scope: r.scope,
						script: (r.active ?? r.waiting ?? r.installing)?.scriptURL,
					})),
				);
			const before = await registrations();
			if (label === "sw") {
				expect(before.map((r) => r.script)).toEqual([
					`${TEST_RUNNER_ORIGIN}/runner/sw.js`,
				]);
			}

			const outcome = await probe<Record<string, string>>(
				h,
				`const out = {};
				const attempt = async (name, fn) => {
					try { await fn(); out[name] = "worked"; } catch { out[name] = "blocked"; }
				};
				await attempt("register", () => navigator.serviceWorker.register("/runner/sw.js", { scope: "/runner/" }));
				await attempt("registerOther", () => navigator.serviceWorker.register(URL.createObjectURL(new Blob(["1"])), { scope: "/runner/" }));
				await attempt("getRegistration", () => navigator.serviceWorker.getRegistration());
				await attempt("viaProto", () => Object.getPrototypeOf(navigator).serviceWorker.register("/runner/sw.js"));
				console.log(JSON.stringify(out));`,
			);
			expect(outcome).toEqual({
				register: "blocked",
				registerOther: "blocked",
				getRegistration: "blocked",
				viaProto: "blocked",
			});
			expect(await registrations()).toEqual(before);
		});
	}
});

test.describe("nothing persists between runs", () => {
	/// Tries every way to keep data and records what each did.
	const PERSIST = `const out = {};
		const attempt = async (name, fn) => {
			try { await fn(); out[name] = "worked"; } catch { out[name] = "blocked"; }
		};
		await attempt("indexedDB", () => indexedDB.open("leak"));
		await attempt("caches", async () => (await caches.open("leak")).put("/x", new Response("x")));
		await attempt("opfs", async () => (await navigator.storage.getDirectory()).getFileHandle("leak.txt", { create: true }));
		await attempt("serviceWorker", () => navigator.serviceWorker.register("/runner/sw.js"));
		await attempt("broadcast", () => new BroadcastChannel("leak"));
		await attempt("worker", () => new Worker(URL.createObjectURL(new Blob(["1"]))));
		globalThis.leaked = "yes";
		console.log(JSON.stringify(out));`;

	/// Looks for what the previous run tried to leave behind.
	const LOOK = `const out = {
			global: typeof globalThis.leaked,
			indexedDB: typeof indexedDB,
			caches: typeof caches,
			storage: typeof navigator.storage,
		};
		console.log(JSON.stringify(out));`;

	test("a run that tries every way to persist leaves nothing for the next, nor after a reload", async ({
		page,
	}) => {
		let h = await loadFrame(page);

		const attempts = await probe<Record<string, string>>(h, PERSIST);
		expect(attempts).toEqual({
			indexedDB: "blocked",
			caches: "blocked",
			opfs: "blocked",
			serviceWorker: "blocked",
			broadcast: "blocked",
			worker: "blocked",
		});
		expect(await originStorage(h.frame)).toEqual(EMPTY_STORAGE);

		const nothing = {
			global: "undefined",
			indexedDB: "undefined",
			caches: "undefined",
			storage: "undefined",
		};
		expect(await probe(h, LOOK)).toEqual(nothing);

		h = await loadFrame(page, "", { navigate: false });
		expect(await originStorage(h.frame)).toEqual(EMPTY_STORAGE);
		expect(await probe(h, LOOK)).toEqual(nothing);
	});

	test("the frame wipes IndexedDB, Cache Storage and OPFS on load and at each run", async ({
		page,
	}) => {
		let h = await loadFrame(page);
		await plantInOrigin(h.frame);
		expect((await originStorage(h.frame)).databases).toContain("planted");

		h = await loadFrame(page, "", { navigate: false });
		await expect
			.poll(() => originStorage(h.frame), { timeout: 8000 })
			.toEqual(EMPTY_STORAGE);

		await plantInOrigin(h.frame);
		await run(h, "console.log('hi')");
		await expect
			.poll(() => originStorage(h.frame), { timeout: 8000 })
			.toEqual(EMPTY_STORAGE);
	});
});

test.describe("stdin channel is bound to its Worker (sw transport)", () => {
	test("another client cannot read or steal the channel of a run", async ({
		page,
	}) => {
		const h = await loadFrame(page, "?isolation=off");
		const owner = await start(h, "read", "fake");
		await waitFor(h, owner, "status", "waiting-input");

		const fromFrameWindow = await h.frame.evaluate(async (path) => {
			const response = await fetch(path);
			return {
				status: response.status,
				stdin: response.headers.get("X-Stdin"),
			};
		}, `${SW_STDIN_PATH}${owner}`);
		expect([403, 410]).toContain(fromFrameWindow.status);
		expect(fromFrameWindow.stdin).toBeNull();

		// A run that is a different Worker, same origin, same service worker.
		const other = await probe<Record<string, number>>(
			h,
			`const get = (id) => {
				const x = new XMLHttpRequest();
				x.open("GET", ${JSON.stringify(SW_STDIN_PATH)} + id, false);
				x.send();
				return x.status;
			};
			console.log(JSON.stringify({ owner: get(${JSON.stringify(owner)}), unknown: get(${JSON.stringify(randomUUID())}) }));`,
		);
		expect([403, 410]).toContain(other.owner);
		expect(other.unknown).toBe(410);

		// The owner's channel survived all of that.
		await send(h, { type: "stdin", runId: owner, line: "for-the-owner" });
		const result = await collect(h, owner);
		expect(result.stdout).toBe("for-the-owner\n");
		expect(result.exit).toMatchObject({ reason: "exited", code: 0 });
	});
});

test.describe("floods are contained by the output limit", () => {
	test.setTimeout(90_000);

	test("empty output messages forged by the Worker end the run with output-limit", async ({
		page,
	}) => {
		const h = await loadFrame(page);
		const result = await run(
			h,
			`for (let i = 0; i < ${OUTPUT_MESSAGES_LIMIT * 3}; i++) {
				postMessage({ type: "output", stream: "stdout", text: "" });
			}
			console.log("survived");`,
		);
		expect(result.exit).toMatchObject({ reason: "output-limit", code: null });
		expect(result.stdout).not.toContain("survived");
		expect(await run(h, "console.log('still alive')")).toMatchObject({
			stdout: "still alive\n",
		});
	});

	test("forged status messages cannot flood the app either", async ({
		page,
	}) => {
		const h = await loadFrame(page);
		const result = await run(
			h,
			`const states = ["loading", "running"];
			for (let i = 0; i < ${OUTPUT_MESSAGES_LIMIT * 3}; i++) {
				postMessage({ type: "status", state: states[i % 2] });
			}
			console.log("survived");`,
		);
		const statuses = result.messages.filter((m) => m.type === "status");
		expect(statuses.length).toBeLessThanOrEqual(OUTPUT_MESSAGES_LIMIT + 10);
		expect(result.exit.reason).toBe("output-limit");
		expect(await run(h, "console.log('still alive')")).toMatchObject({
			stdout: "still alive\n",
		});
	});
});

test.describe("repeated runId", () => {
	test("a second run with the same runId is ignored and the first keeps going", async ({
		page,
	}) => {
		const h = await loadFrame(page);
		const id = await start(h, `prompt(); console.log("first")`);
		await waitFor(h, id, "status", "waiting-input");
		const before = (await messagesOf(h, id)).length;

		await send(h, runMessage(id, `console.log("second")`));
		await page.waitForTimeout(500); // nothing is expected: give a reply time to show up
		expect(await messagesOf(h, id)).toHaveLength(before);

		await send(h, { type: "stdin", runId: id, line: "go" });
		const result = await collect(h, id);
		expect(result.stdout).toContain("first");
		expect(result.stdout).not.toContain("second");
		expect(result.exit).toMatchObject({ reason: "exited", code: 0 });
		expect(result.messages.filter((m) => m.type === "exit")).toHaveLength(1);
	});

	test("the id of a finished run stays used until the frame reloads", async ({
		page,
	}) => {
		let h = await loadFrame(page);
		const id = await start(h, `console.log("once")`);
		await collect(h, id);
		const before = (await messagesOf(h, id)).length;

		await send(h, runMessage(id, `console.log("again")`));
		await page.waitForTimeout(500);
		expect(await messagesOf(h, id)).toHaveLength(before);

		h = await loadFrame(page, "", { navigate: false });
		expect(
			(
				await collect(
					h,
					await start(h, `console.log("fresh")`, "javascript", id),
				)
			).stdout,
		).toBe("fresh\n");
	});
});

test.describe("who may talk to the frame", () => {
	test("the frame does not load inside a page of another origin", async ({
		page,
		context,
	}) => {
		// Control: the same frame does load (and says `ready`) inside the app.
		await loadFrame(await context.newPage());

		await serveOtherOrigin(context);
		await page.goto(`${OTHER_ORIGIN}/`);
		await page.evaluate((origin) => {
			const w = window as unknown as RunnerWindow;
			w.__runnerMessages = [];
			window.addEventListener("message", (event) => {
				if (event.origin === origin) w.__runnerMessages.push(event.data);
			});
			const iframe = document.createElement("iframe");
			iframe.id = "runner-frame";
			iframe.src = `${origin}/runner/frame`;
			document.body.append(iframe);
		}, TEST_RUNNER_ORIGIN);

		await page.waitForTimeout(2500); // a frame that was going to load has by now
		const frame =
			(await (
				await page.locator("#runner-frame").elementHandle()
			)?.contentFrame()) ?? null;
		expect(frame?.url().startsWith(TEST_RUNNER_ORIGIN)).not.toBe(true);
		const messages = await page.evaluate(
			() => (window as unknown as RunnerWindow).__runnerMessages,
		);
		expect(messages).toEqual([]);
	});

	/// What a hostile window tries against a frame that serves the app:
	/// start a run, stop another, type into another. None may take effect.
	async function attack(h: Harness, forge: ForgedSender) {
		const victimLoop = await start(h, "while (true) {}");
		const victimRead = await start(h, `console.log("read:" + prompt())`);
		await waitFor(h, victimRead, "status", "waiting-input");

		const hijacked = randomUUID();
		await forge(runMessage(hijacked, `console.log("hijacked")`));
		await forge({ type: "stop", runId: victimLoop });
		await forge({ type: "stdin", runId: victimRead, line: "evil" });
		await forge({ type: "stdin-eof", runId: victimRead });
		await h.page.waitForTimeout(1000); // nothing is expected: give them time to act

		expect(await messagesOf(h, hijacked), "forged run").toEqual([]);
		expect(
			(await messagesOf(h, victimLoop)).some((m) => m.type === "exit"),
			"forged stop",
		).toBe(false);
		expect(
			(await messagesOf(h, victimRead)).some((m) => m.type === "exit"),
			"forged stdin and eof",
		).toBe(false);

		// The runId the hostile window used was not consumed: the app can still use it.
		const legit = await collect(
			h,
			await start(h, `console.log("legit")`, "javascript", hijacked),
		);
		expect(legit.stdout).toBe("legit\n");

		await send(h, { type: "stdin", runId: victimRead, line: "good" });
		expect((await collect(h, victimRead)).stdout).toBe("read:good\n");
		await send(h, { type: "stop", runId: victimLoop });
		expect((await collect(h, victimLoop)).exit.reason).toBe("stopped");
	}

	test("a popup of another origin opened by the app cannot drive the frame", async ({
		page,
		context,
	}) => {
		await serveOtherOrigin(context);
		const h = await loadFrame(page);
		const [popup] = await Promise.all([
			context.waitForEvent("page"),
			page.evaluate((url) => void window.open(url), `${OTHER_ORIGIN}/popup`),
		]);
		await popup.waitForLoadState();
		await attack(h, (message) =>
			popup.evaluate((m) => {
				// `frames[0]` of a cross-origin opener is reachable by design.
				window.opener.frames[0].postMessage(m, "*");
			}, message),
		);
	});

	test("a window of another origin that opened the app cannot drive the frame", async ({
		page: attacker,
		context,
	}) => {
		await serveOtherOrigin(context);
		await attacker.goto(`${OTHER_ORIGIN}/`);
		const [appPage] = await Promise.all([
			context.waitForEvent("page"),
			attacker.evaluate((url) => {
				(window as unknown as { __app: Window | null }).__app =
					window.open(url);
			}, `${TEST_BASE_URL}/login`),
		]);
		await appPage.waitForLoadState();
		const h = await loadFrame(appPage, "", { navigate: false });
		await attack(h, (message) =>
			attacker.evaluate((m) => {
				(window as unknown as { __app: Window }).__app.frames[0]?.postMessage(
					m,
					"*",
				);
			}, message),
		);
	});
});
