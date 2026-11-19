/**
 * A browser-less client of the server: one cookie jar per student, Astro
 * actions over HTTP, and a timing record of every request.
 */

import { decodeIslandProps } from "../helpers/astro-island-props";
import { parseDevalue } from "../helpers/devalue-lite";

/// One request as the load saw it.
export interface Sample {
	/// Milliseconds since the start of the run.
	at: number;
	/// `exam.answer`, `exam.answer:SUBMIT`, `page:exam`, `login`, ...
	name: string;
	status: number;
	ms: number;
	/// Action error code, `timeout` or `network`; absent on success.
	error?: string;
	/// The user that made it (absent in older reports).
	who?: string;
}

export class Recorder {
	readonly samples: Sample[] = [];
	constructor(readonly startedAt: number) {}

	record(sample: Omit<Sample, "at">, started: number): void {
		this.samples.push({ ...sample, at: started - this.startedAt });
	}
}

export interface ActionOutcome<T = unknown> {
	data?: T;
	error?: { code?: string; message?: string };
}

/// What the client gives up after, like a browser would show a hung request.
const REQUEST_TIMEOUT_MS = 60_000;

export class StudentHttp {
	private readonly cookies = new Map<string, string>();

	constructor(
		readonly base: string,
		private readonly recorder: Recorder,
		private readonly who?: string,
	) {}

	private cookieHeader(): string {
		return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
	}

	private keepCookies(response: Response): void {
		for (const line of response.headers.getSetCookie()) {
			const pair = line.split(";")[0] ?? "";
			const index = pair.indexOf("=");
			if (index > 0)
				this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1));
		}
	}

	private async request(
		name: string,
		url: string,
		init: RequestInit,
	): Promise<{ status: number; text: string } | { failure: string }> {
		const started = performance.now() + performance.timeOrigin;
		const t0 = performance.now();
		try {
			const response = await fetch(new URL(url, this.base), {
				...init,
				redirect: "manual",
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
				headers: {
					...(init.headers as Record<string, string>),
					cookie: this.cookieHeader(),
					origin: new URL(this.base).origin,
				},
			});
			this.keepCookies(response);
			const text = await response.text();
			const ms = performance.now() - t0;
			let error: string | undefined;
			if (response.status >= 400) {
				try {
					error = JSON.parse(text).code ?? String(response.status);
				} catch {
					error = String(response.status);
				}
			}
			this.recorder.record(
				{ name, status: response.status, ms, error, who: this.who },
				started,
			);
			return { status: response.status, text };
		} catch (thrown) {
			const ms = performance.now() - t0;
			const failure =
				thrown instanceof Error && thrown.name === "TimeoutError"
					? "timeout"
					: "network";
			this.recorder.record(
				{ name, status: 0, ms, error: failure, who: this.who },
				started,
			);
			return { failure };
		}
	}

	/// Logs in through the login form's action.
	async login(login: string, password: string): Promise<boolean> {
		const result = await this.request("auth.login", "/_actions/auth.login", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ login, password }).toString(),
		});
		return "status" in result && result.status === 200;
	}

	/// Calls an action as `astro:actions` does; `label` names it in the report when it differs.
	async action<T = unknown>(
		name: string,
		input: unknown,
		label = name,
	): Promise<ActionOutcome<T>> {
		const result = await this.request(label, `/_actions/${name}`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json",
			},
			body: JSON.stringify(input),
		});
		if ("failure" in result) throw new Error(result.failure);
		if (result.status === 200) return { data: parseDevalue(result.text) as T };
		if (result.status === 204) return { data: undefined };
		try {
			const body = JSON.parse(result.text);
			return { error: { code: body.code, message: body.message } };
		} catch {
			return { error: { code: String(result.status), message: result.text } };
		}
	}

	/// Loads a page and returns the props of its first island named `component`, if any.
	async page(
		name: string,
		url: string,
		component?: string,
	): Promise<Record<string, unknown> | null> {
		const result = await this.request(name, url, { method: "GET" });
		if ("failure" in result || result.status !== 200 || !component) return null;
		for (const match of result.text.matchAll(/<astro-island\b[^>]*>/g)) {
			const tag = match[0];
			if (!tag.includes(component)) continue;
			const props = tag.match(/\sprops="([^"]*)"/);
			if (props?.[1] !== undefined)
				return decodeIslandProps(unescapeHtml(props[1]));
		}
		return null;
	}
}

function unescapeHtml(text: string): string {
	return text
		.replaceAll("&quot;", '"')
		.replaceAll("&#39;", "'")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&amp;", "&");
}
