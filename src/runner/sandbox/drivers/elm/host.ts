/**
 * Runs the Guida compiler's command line (`Elm.Terminal.Main`) without Node.
 *
 * Guida does every file, process and console operation through an HTTP
 * request to a fixed name (`POST hPutStr`, `POST read`...), which its own
 * launcher answers with a mock server and Node APIs. This module answers
 * the same requests from a `MemFs` and the callbacks of a `GuidaIo`, by
 * replacing the global `XMLHttpRequest` while a command runs. Requests to
 * real URLs (the package registry) go to `GuidaIo.fetch`.
 *
 * Only one command runs at a time per global scope.
 */

import type { MemFs } from "./fs";

/** What a running command may use besides the file system. */
export interface GuidaIo {
	readonly fs: MemFs;
	/// Command line, e.g. `["make", "src/Main.elm", "--report=json"]`.
	readonly args: readonly string[];
	readonly env?: Readonly<Record<string, string>>;
	stdout(text: string): void;
	stderr(text: string): void;
	/// Shows `prompt` and blocks for a line; null at end of input.
	readLine?(prompt: string): string | null;
	/// Runs the JavaScript the REPL hands to `node`; returns its exit code.
	runJs?(code: string): number;
	/// Answers a request to a real URL; null refuses it.
	fetch?(method: string, url: string, body: unknown): HostResponse | null;
	/// Answers `getArchive`: the files of the package zip at `url`.
	archive?(url: string): { sha: string; archive: ArchiveEntry[] } | null;
}

/** A response of the host to one request. */
export interface HostResponse {
	status: number;
	body: unknown;
}

/** One file of a package archive, as Guida expects it. */
export interface ArchiveEntry {
	eRelativePath: string;
	eData: string;
}

/** The compiled Guida command line, as `bin/guida.min.js` defines it. */
export interface GuidaElm {
	Terminal: { Main: { init(): unknown } };
}

/// A request the host answers, through `respond`.
interface HostRequest {
	readonly url: string;
	readonly method: string;
	readonly headers: Readonly<Record<string, string>>;
	readonly body: unknown;
	respond(status: number, body?: unknown): void;
}

type Handler = (request: HostRequest) => void;

/// The handlers of the command that is running.
let active: { handlers: Map<string, Handler>; fallback: Handler } | null = null;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/// Bytes of a request body, whatever form Guida sent it in.
function bytesOf(body: unknown): Uint8Array {
	if (typeof body === "string") return encoder.encode(body);
	if (body instanceof ArrayBuffer) return new Uint8Array(body);
	if (ArrayBuffer.isView(body)) {
		return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
	}
	return encoder.encode(String(body ?? ""));
}

/// An `ArrayBuffer` holding exactly `bytes`.
function exactBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	) as ArrayBuffer;
}

/**
 * The part of `XMLHttpRequest` that Guida's HTTP kernel uses, answered by the
 * active handlers instead of the network.
 */
class HostXhr {
	responseType: XMLHttpRequestResponseType = "";
	status = 0;
	statusText = "";
	response: unknown = null;
	responseURL = "";
	timeout = 0;
	withCredentials = false;
	readonly upload = { addEventListener() {} };
	onload: (() => void) | null = null;
	onerror: (() => void) | null = null;
	#method = "GET";
	#url = "";
	#headers: Record<string, string> = {};
	#listeners: Record<string, (() => void)[]> = {};
	#aborted = false;

	get responseText(): string {
		return typeof this.response === "string" ? this.response : "";
	}

	addEventListener(type: string, listener: () => void): void {
		const list = this.#listeners[type] ?? [];
		this.#listeners[type] = list;
		list.push(listener);
	}

	open(method: string, url: string): void {
		this.#method = method;
		this.#url = url;
	}

	setRequestHeader(name: string, value: string): void {
		this.#headers[name.toLowerCase()] = value;
	}

	getAllResponseHeaders(): string {
		return "";
	}

	abort(): void {
		this.#aborted = true;
	}

	send(body?: unknown): void {
		const host = active;
		if (!host) throw new Error("Guida made a request while no command runs.");
		let answered = false;
		const request: HostRequest = {
			url: this.#url,
			method: this.#method,
			headers: this.#headers,
			body,
			respond: (status, payload) => {
				if (answered) return;
				answered = true;
				queueMicrotask(() => this.#finish(status, payload));
			},
		};
		const handler = /^\w+$/.test(this.#url)
			? host.handlers.get(this.#url)
			: host.fallback;
		if (!handler) {
			throw new Error(
				`Guida asked for "${this.#url}", which is not supported.`,
			);
		}
		handler(request);
	}

	#finish(status: number, payload: unknown): void {
		if (this.#aborted) return;
		this.status = status;
		this.statusText = status === 200 ? "OK" : String(status);
		this.responseURL = this.#url;
		this.response =
			this.responseType === "arraybuffer"
				? payload instanceof ArrayBuffer
					? payload
					: exactBuffer(bytesOf(payload))
				: typeof payload === "string"
					? payload
					: payload instanceof ArrayBuffer || ArrayBuffer.isView(payload)
						? decoder.decode(bytesOf(payload))
						: payload == null
							? ""
							: String(payload);
		this.onload?.();
		for (const listener of this.#listeners.load ?? []) listener();
	}
}

/// A Haskell `MVar`: a box that is empty or holds one value, with waiters.
interface MVar {
	value: unknown;
	waiting: {
		action: "read" | "take" | "put";
		request: HostRequest;
		value?: unknown;
	}[];
}

/// The `buffer` of a value Guida put in an `MVar` (a `DataView` of its bytes).
function bufferOf(value: unknown): unknown {
	return (value as { buffer?: unknown }).buffer;
}

/// Handlers for every request name `bin/index.js` answers.
function handlersFor(
	io: GuidaIo,
	exit: (code: number) => void,
): Map<string, Handler> {
	const { fs } = io;
	const handlers = new Map<string, Handler>();
	const on = (name: string, handler: Handler) => handlers.set(name, handler);

	/// Open handles: files opened with `withFile` and the stdin of a process.
	const handles = new Map<number, { path?: string; data: string }>();
	let nextHandle = 10;
	const processes = new Map<number, number>();
	let nextProcess = 0;
	const locks = new Map<string, HostRequest[]>();
	const mvars = new Map<number, MVar>();
	let nextMVar = 0;
	let state: unknown;

	const notFound = (what: string, path: string) =>
		new Error(`Guida: ${what}: no such file "${path}".`);

	on("hPutStr", (r) => {
		const fd = Number(r.headers.fd);
		const text =
			typeof r.body === "string" ? r.body : decoder.decode(bytesOf(r.body));
		if (fd === 1) io.stdout(text);
		else if (fd === 2) io.stderr(text);
		else {
			const handle = handles.get(fd);
			if (!handle) throw new Error(`Guida wrote to unknown handle ${fd}.`);
			handle.data += text;
			if (handle.path) fs.write(handle.path, handle.data);
		}
		r.respond(200);
	});
	on("withFile", (r) => {
		const fd = nextHandle++;
		const path = String(r.body);
		const mode = r.headers.mode ?? "w";
		const existing = fs.read(path);
		const data =
			mode.startsWith("a") && existing ? decoder.decode(existing) : "";
		if (!mode.startsWith("r")) fs.write(path, data);
		handles.set(fd, { path, data });
		r.respond(200, fd);
	});
	on("hFileSize", (r) => {
		const handle = handles.get(Number(r.body));
		r.respond(200, handle ? encoder.encode(handle.data).length : 0);
	});
	on("hClose", (r) => {
		const fd = Number(r.body);
		if (!processes.size || ![...processes.values()].includes(fd))
			handles.delete(fd);
		r.respond(200);
	});
	on("withCreateProcess", (r) => {
		const fd = nextHandle++;
		handles.set(fd, { data: "" });
		const ph = ++nextProcess;
		processes.set(ph, fd);
		r.respond(200, JSON.stringify({ stdinHandle: fd, ph }));
	});
	on("waitForProcess", (r) => {
		const ph = Number(r.body);
		const fd = processes.get(ph);
		const code = handles.get(fd ?? -1)?.data ?? "";
		processes.delete(ph);
		if (fd !== undefined) handles.delete(fd);
		const status = io.runJs ? io.runJs(code) : 1;
		r.respond(200, status);
	});
	on("dirFindExecutable", (r) => {
		r.respond(
			200,
			JSON.stringify(r.body === "node" && io.runJs ? "/usr/bin/node" : null),
		);
	});
	on("exitWith", (r) => {
		exit(Number(r.body) || 0);
	});
	on("replGetInputLine", (r) => {
		const line = io.readLine ? io.readLine(String(r.body)) : null;
		r.respond(200, JSON.stringify(line));
	});
	on("getLine", (r) => {
		r.respond(200, io.readLine?.("") ?? "");
	});
	on("readStdin", (r) => r.respond(200, ""));
	on("writeString", (r) => {
		fs.write(r.headers.path ?? "", String(r.body));
		r.respond(200);
	});
	on("write", (r) => {
		fs.write(r.headers.path ?? "", bytesOf(r.body).slice());
		r.respond(200);
	});
	on("read", (r) => {
		const data = fs.read(String(r.body));
		if (!data) throw notFound("read", String(r.body));
		r.respond(200, decoder.decode(data));
	});
	on("binaryDecodeFileOrFail", (r) => {
		const data = fs.read(String(r.body));
		if (!data) throw notFound("decode", String(r.body));
		r.respond(200, exactBuffer(data));
	});
	on("dirDoesFileExist", (r) => r.respond(200, fs.isFile(String(r.body))));
	on("dirDoesDirectoryExist", (r) => r.respond(200, fs.isDir(String(r.body))));
	on("dirCreateDirectoryIfMissing", (r) => {
		fs.mkdir(JSON.parse(String(r.body)).filename);
		r.respond(200);
	});
	on("dirGetModificationTime", (r) => {
		r.respond(200, fs.mtime(String(r.body)) ?? 0);
	});
	on("dirCanonicalizePath", (r) => r.respond(200, fs.resolve(String(r.body))));
	on("dirListDirectory", (r) => {
		r.respond(200, JSON.stringify(fs.list(String(r.body))));
	});
	on("dirRemoveFile", (r) => {
		fs.remove(String(r.body));
		r.respond(200);
	});
	on("dirRemoveDirectoryRecursive", (r) => {
		fs.removeTree(String(r.body));
		r.respond(200);
	});
	on("dirWithCurrentDirectory", (r) => {
		fs.cwd = fs.resolve(String(r.body));
		r.respond(200);
	});
	on("dirGetCurrentDirectory", (r) => r.respond(200, fs.cwd));
	on("dirGetAppUserDataDirectory", (r) => r.respond(200, `/home/.${r.body}`));
	on("envGetArgs", (r) => r.respond(200, JSON.stringify(io.args)));
	on("envLookupEnv", (r) => {
		r.respond(200, JSON.stringify(io.env?.[String(r.body)] ?? null));
	});
	on("getArchive", (r) => {
		const result = io.archive?.(String(r.body));
		if (!result) throw new Error(`Guida: cannot download ${r.body}.`);
		r.respond(200, JSON.stringify(result));
	});
	on("httpUpload", (r) => {
		io.stderr("Publishing packages is not supported.\n");
		r.respond(200);
	});
	on("putStateT", (r) => {
		state = r.body;
		r.respond(200);
	});
	on("getStateT", (r) => r.respond(200, bufferOf(state)));
	on("lockFile", (r) => {
		const path = String(r.body);
		const queue = locks.get(path);
		if (queue) queue.push(r);
		else {
			locks.set(path, []);
			r.respond(200);
		}
	});
	on("unlockFile", (r) => {
		const path = String(r.body);
		const next = locks.get(path)?.shift();
		if (next) next.respond(200);
		else locks.delete(path);
		r.respond(200);
	});
	on("newEmptyMVar", (r) => {
		mvars.set(++nextMVar, { value: undefined, waiting: [] });
		r.respond(200, nextMVar);
	});
	const mvar = (id: unknown): MVar => {
		const found = mvars.get(Number(id));
		if (!found) throw new Error(`Guida used unknown MVar ${id}.`);
		return found;
	};
	on("readMVar", (r) => {
		const m = mvar(r.body);
		if (m.value === undefined) m.waiting.push({ action: "read", request: r });
		else r.respond(200, bufferOf(m.value));
	});
	on("takeMVar", (r) => {
		const m = mvar(r.body);
		if (m.value === undefined) {
			m.waiting.push({ action: "take", request: r });
			return;
		}
		const value = m.value;
		m.value = undefined;
		if (m.waiting[0]?.action === "put") {
			const putter = m.waiting.shift();
			m.value = putter?.value;
			putter?.request.respond(200);
		}
		r.respond(200, bufferOf(value));
	});
	on("putMVar", (r) => {
		const m = mvar(r.headers.id);
		const value = r.body;
		if (m.value !== undefined) {
			m.waiting.push({ action: "put", request: r, value });
			return;
		}
		m.value = value;
		m.waiting = m.waiting.filter((w) => {
			if (w.action === "read") w.request.respond(200, bufferOf(value));
			return w.action !== "read";
		});
		const next = m.waiting.shift();
		if (next) {
			next.request.respond(200, bufferOf(value));
			if (next.action === "take") m.value = undefined;
		}
		r.respond(200);
	});
	on("nodeGetDirname", (r) => r.respond(200, "/guida"));
	on("nodeMathRandom", (r) => r.respond(200, Math.random()));
	return handlers;
}

/**
 * Runs one Guida command and resolves with its exit code.
 *
 * Replaces the global `XMLHttpRequest` until the command exits, so nothing
 * else in this scope may use it meanwhile.
 *
 * @throws {Error} when Guida asks for something this host does not support.
 */
export function runGuida(elm: GuidaElm, io: GuidaIo): Promise<number> {
	if (active) throw new Error("A Guida command is already running.");
	const scope = globalThis as { XMLHttpRequest?: unknown };
	const original = scope.XMLHttpRequest;
	return new Promise<number>((resolve, reject) => {
		const done = (finish: () => void) => {
			active = null;
			scope.XMLHttpRequest = original;
			finish();
		};
		const handlers = handlersFor(io, (code) => done(() => resolve(code)));
		const wrap =
			(handler: Handler): Handler =>
			(request) => {
				try {
					handler(request);
				} catch (error) {
					done(() => reject(error));
				}
			};
		for (const [name, handler] of handlers) handlers.set(name, wrap(handler));
		active = {
			handlers,
			// Guida's launcher answers every request to a real URL with status
			// 200 and the body it got, and Guida treats any other status as a
			// crash; a missing file shows up as a body it cannot parse.
			fallback: wrap((request) => {
				const answer = io.fetch?.(request.method, request.url, request.body);
				if (!answer) {
					io.stderr(`elm: network access is disabled (${request.url})\n`);
				}
				request.respond(200, answer?.body ?? "");
			}),
		};
		scope.XMLHttpRequest = HostXhr;
		try {
			elm.Terminal.Main.init();
		} catch (error) {
			done(() => reject(error));
		}
	});
}
