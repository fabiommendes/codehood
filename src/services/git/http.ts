import { PassThrough, Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { m } from "@/i18n";
import {
	advertiseRefs,
	GitBusyError,
	GitTimeoutError,
	receivePack,
	uploadPack,
} from "./bare";
import type { PushMessages, PushRules } from "./hook";

/// The smart HTTP protocol of the bare repositories as web `Request`s and
/// `Response`s, for the routes that decide who may reach which repository.

/** The services of the smart HTTP protocol. */
export type GitService = "git-upload-pack" | "git-receive-pack";

/** What a request to a repository asks for. */
export type GitRequest =
	| { kind: "advertise"; service: GitService }
	| { kind: "rpc"; service: GitService };

/**
 * Reads the smart HTTP request that `method` and `path` (relative to the repository) name.
 *
 * Returns `null` for anything else, which includes the dumb protocol.
 */
export function parseGitRequest(
	method: string,
	path: string,
	query: URLSearchParams,
): GitRequest | null {
	if (method === "GET" && path === "info/refs") {
		const service = query.get("service");
		return service === "git-upload-pack" || service === "git-receive-pack"
			? { kind: "advertise", service }
			: null;
	}
	if (method === "POST") {
		if (path === "git-upload-pack" || path === "git-receive-pack") {
			return { kind: "rpc", service: path };
		}
	}
	return null;
}

/** The refusal messages of the push hook, in the language of the instance. */
export function pushMessages(): PushMessages {
	// The hook fills `{path}` and `{limit}` in, so they travel as they are.
	return {
		wrongRef: m.git_push_wrong_ref(),
		closed: m.git_push_closed(),
		notEnrolled: m.git_push_not_enrolled(),
		fileTooLarge: m.git_push_file_too_large({
			path: "{path}",
			limit: "{limit}",
		}),
		pathDenied: m.git_push_path_denied({ path: "{path}" }),
		repositoryFull: m.git_push_repository_full(),
	};
}

/// The request body as a stream, gunzipped when the client compressed it.
function bodyOf(request: Request): Readable {
	if (!request.body) return Readable.from([]);
	const body = Readable.fromWeb(
		request.body as Parameters<typeof Readable.fromWeb>[0],
	);
	if (request.headers.get("content-encoding")?.toLowerCase() !== "gzip") {
		return body;
	}
	const gunzip = createGunzip();
	body.on("error", (error) => gunzip.destroy(error));
	return body.pipe(gunzip);
}

/// A stream that ends only after `before` has run, and is gone when its consumer is.
function endAfter(source: Readable, before: () => Promise<void>): Readable {
	const out = new PassThrough();
	source.pipe(out, { end: false });
	source.once("end", () => {
		void before()
			.catch(() => {})
			.finally(() => out.end());
	});
	source.once("error", (error) => out.destroy(error));
	out.once("close", () => source.destroy());
	return out;
}

/// The answer to an operation that did not start or failed.
function failure(error: unknown): Response {
	if (error instanceof GitBusyError) {
		return new Response("Too many git operations in progress\n", {
			status: 429,
			headers: {
				"Content-Type": "text/plain; charset=utf-8",
				"Retry-After": String(error.retryAfterSeconds),
			},
		});
	}
	console.error("git request failed:", error);
	return new Response("Git failed\n", {
		status: error instanceof GitTimeoutError ? 504 : 500,
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
}

/** What serving a request to a team repository needs beyond the request. */
export type ServeOptions = {
	teamId: number;
	/// The ceiling key: one operation at a time runs for each key.
	key: string;
	request: Request;
	git: GitRequest;
	/// The rules of a push; without them the repository is read-only.
	rules?: PushRules;
	/// Runs after a push ends and before its response does.
	afterPush?: () => Promise<void>;
};

/**
 * Serves one smart HTTP request to the repository of a team.
 *
 * The body goes to git as a stream and the answer comes back as one, with the
 * refusal of a busy server as 429 and the end of a push held until
 * `afterPush` returns.
 */
export async function serveGit(options: ServeOptions): Promise<Response> {
	const { teamId, key, request, git, rules } = options;
	const { service } = git;
	try {
		if (git.kind === "advertise") {
			if (service === "git-receive-pack" && !rules) return notFound();
			const body = await advertiseRefs(teamId, service, key);
			return new Response(new Uint8Array(body), {
				status: 200,
				headers: {
					"Content-Type": `application/x-${service}-advertisement`,
					"Cache-Control": "no-cache",
				},
			});
		}
		let output: Readable;
		if (service === "git-upload-pack") {
			output = uploadPack(teamId, bodyOf(request), key);
		} else {
			if (!rules) return notFound();
			output = receivePack(teamId, bodyOf(request), key, rules);
			if (options.afterPush) output = endAfter(output, options.afterPush);
		}
		request.signal.addEventListener("abort", () => output.destroy(), {
			once: true,
		});
		return new Response(Readable.toWeb(output) as unknown as ReadableStream, {
			status: 200,
			headers: {
				"Content-Type": `application/x-${service}-result`,
				"Cache-Control": "no-cache",
			},
		});
	} catch (error) {
		return failure(error);
	}
}

/** The 404 of every refusal to a git client. */
export function notFound(): Response {
	return new Response("Not found\n", {
		status: 404,
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
}
