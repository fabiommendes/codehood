import type { APIContext } from "astro";
import { z } from "zod";
import { responseFromException } from "@/core/error-server";
import { getRouteMapping } from "./route";

const MAX_ITEM_BYTES = 64 * 1024;

export const restBatchInput = z
	.object({
		verb: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
		requests: z
			.array(
				z
					.object({
						id: z.union([z.string(), z.number()]),
						path: z.string(),
						body: z.unknown().optional(),
						query: z
							.record(z.string(), z.union([z.string(), z.array(z.string())]))
							.optional(),
					})
					.strict(),
			)
			.min(1)
			.max(50),
	})
	.strict();

export const restBatchOutput = z.array(
	z.object({
		id: z.union([z.string(), z.number()]),
		status: z.number().int(),
		body: z.unknown(),
	}),
);

type BatchInput = z.infer<typeof restBatchInput>;
type BatchResult = z.infer<typeof restBatchOutput>[number];

/**
 * Runs registered JSON REST operations in order without a global transaction.
 */
export async function executeRestBatch(
	input: BatchInput,
	context: APIContext,
): Promise<BatchResult[]> {
	const results: BatchResult[] = [];
	for (const item of input.requests) {
		try {
			const response = await executeItem(input.verb, item, context);
			results.push({
				id: item.id,
				status: response.status,
				body: await response.json(),
			});
		} catch (error) {
			const body = responseFromException(error, true);
			results.push({ id: item.id, status: body.status, body });
		}
	}
	return results;
}

/// Resolves only unambiguous local paths and delegates validation to the REST view.
async function executeItem(
	verb: BatchInput["verb"],
	item: BatchInput["requests"][number],
	context: APIContext,
): Promise<Response> {
	const reject = (status: number, message: string) =>
		Response.json({ status, message }, { status });
	if (Buffer.byteLength(JSON.stringify(item), "utf8") > MAX_ITEM_BYTES)
		return reject(413, "REST batch item exceeds 65536 bytes.");
	const readsQuery = verb === "GET" || verb === "DELETE";
	if (
		(readsQuery && Object.hasOwn(item, "body")) ||
		(!readsQuery && item.query !== undefined)
	)
		return reject(400, "Use query for GET/DELETE and body for POST/PUT/PATCH.");

	const segments = localSegments(item.path);
	if (!segments)
		return reject(400, "Expected an unambiguous local /api/ path.");
	const match = matchRoute(segments);
	if (!match) return reject(404, "REST route not found.");
	const route =
		match.methods[verb.toLowerCase() as Lowercase<BatchInput["verb"]>];
	if (!route) return reject(405, "REST method not allowed.");
	if (!route.batchable)
		return reject(400, "This route is not available in rest.batch.");

	const url = new URL(item.path, context.url.origin);
	for (const [key, values] of Object.entries(item.query ?? {})) {
		for (const value of Array.isArray(values) ? values : [values])
			url.searchParams.append(key, value);
	}
	const request = new Request(url, {
		method: verb,
		...(!readsQuery
			? {
					headers: { "content-type": "application/json" },
					body: JSON.stringify(item.body ?? null),
				}
			: {}),
	});
	return route.view({
		...context,
		request,
		url,
		params: match.params,
		routePattern: match.pattern,
	});
}

/// Decode once, rejecting URL normalization and double-decoding ambiguities.
function localSegments(path: string): string[] | undefined {
	if (
		!path.startsWith("/api/") ||
		/[?#\\\s]/u.test(path) ||
		hasControlCharacters(path)
	)
		return undefined;
	try {
		const segments = path.slice(1).split("/").map(decodeURIComponent);
		if (
			segments.some(
				(segment) =>
					!segment ||
					segment === "." ||
					segment === ".." ||
					/[/\\%\s]/u.test(segment) ||
					hasControlCharacters(segment),
			)
		)
			return undefined;
		return segments;
	} catch {
		return undefined;
	}
}

function hasControlCharacters(value: string): boolean {
	return Array.from(value).some(
		(character) =>
			character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
	);
}

/// Static segments outrank dynamic segments, independently of registration order.
function matchRoute(segments: string[]) {
	const entries = Object.entries(getRouteMapping()).sort(([left], [right]) => {
		const a = left.split("/");
		const b = right.split("/");
		for (let index = 0; index < Math.min(a.length, b.length); index++) {
			const difference =
				Number(a[index]?.startsWith("[")) - Number(b[index]?.startsWith("["));
			if (difference) return difference;
		}
		return 0;
	});
	for (const [pattern, methods] of entries) {
		const parts = pattern.slice(1).split("/");
		if (parts.length !== segments.length) continue;
		const params: Record<string, string> = {};
		const matches = parts.every((part, index) => {
			if (/^\[\w+\]$/.test(part)) {
				params[part.slice(1, -1)] = segments[index] ?? "";
				return true;
			}
			return part === segments[index];
		});
		if (matches) return { pattern, methods, params };
	}
	return undefined;
}
