/**
 * Conditional writes over REST (ADR 0013): the `If-Match` and `If-None-Match`
 * headers of a `PUT`, `PATCH` or `DELETE` become the `expectedUpdatedAt` the
 * services check, and the `updatedAt` of a written row goes back as `ETag`.
 *
 * The ETag is the row's `updatedAt` in the exact text a JSON body carries
 * (`Date.prototype.toJSON`, ISO 8601 in UTC with milliseconds), in quotes, so
 * a client builds it from the `updatedAt` of any read model, a listing
 * included. The parsing is strict, and anything it does not accept is a 400,
 * never ignored:
 *
 * - `If-Match` takes exactly one strong ETag. A weak one (`W/"..."`) can never
 *   match under the strong comparison RFC 9110 asks of `If-Match`, so it is a
 *   client error rather than a certain 412. A list and `*` are refused: a
 *   write expects one version, and "any version" is what no header means
 *   already (`PATCH` and `DELETE` answer 404 for a missing row).
 *   A `-gzip`, `-zstd` or `-br` suffix inside the quotes is dropped first: a
 *   proxy that compresses the response rewrites the `ETag` that way and does
 *   not undo it on the request that sends it back.
 * - `If-None-Match` takes only `*`, and only on `PUT`: "create, never
 *   overwrite". RFC 9110 also allows a list of ETags, which on a write means
 *   "unless it is at one of these versions"; no client needs it.
 * - Both headers together are refused.
 * - `GET` and `POST` ignore both: a browser revalidating a cached `GET` sends
 *   `If-None-Match` on its own.
 */
import { type ZodType, z } from "zod";
import { InvalidData } from "@/core/error";
// Adds `.openapi()` to zod before the schemas below use it.
import "@/core/schemas/base";
import { m } from "@/i18n";

/// The `ServiceOpts` slice a request's preconditions fill in.
export type Precondition = { expectedUpdatedAt?: Date | null };

/// The methods whose preconditions a route reads.
type Method = "get" | "post" | "put" | "patch" | "delete";

/// A quoted instant in the one form `Date.prototype.toJSON` writes, followed by
/// at most one of the suffixes a compressing proxy appends to a strong ETag.
const STRONG_ETAG =
	/^"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)(?:-gzip|-zstd|-br)?"$/;

/**
 * Reads the `If-Match` and `If-None-Match` headers of a request into the
 * `expectedUpdatedAt` of its write.
 *
 * Returns `{}` when the request sends neither, or when `method` is `get` or
 * `post`. `versioned` says whether the route writes a row that has a version;
 * a route that does not refuses both headers.
 *
 * @example
 * readPrecondition("put", new Headers({ "If-None-Match": "*" }), true);
 * // { expectedUpdatedAt: null }
 * @throws {InvalidData} When a header is malformed, sent where it does not
 * apply, or sent to a route without version.
 */
export function readPrecondition(
	method: Method,
	headers: Headers,
	versioned: boolean,
): Precondition {
	if (method === "get" || method === "post") return {};
	const ifMatch = headers.get("if-match");
	const ifNoneMatch = headers.get("if-none-match");
	if (ifMatch === null && ifNoneMatch === null) return {};

	if (!versioned) {
		throw refuse(
			ifMatch !== null ? "If-Match" : "If-None-Match",
			m.errors_precondition_unsupported(),
		);
	}
	if (ifMatch !== null && ifNoneMatch !== null) {
		throw refuse("$", m.errors_precondition_both());
	}
	if (ifNoneMatch !== null) {
		if (method !== "put" || ifNoneMatch.trim() !== "*") {
			throw refuse("If-None-Match", m.errors_precondition_if_none_match());
		}
		return { expectedUpdatedAt: null };
	}
	return { expectedUpdatedAt: parseEtag(ifMatch as string) };
}

/**
 * The ETag of a row whose version is `updatedAt`: the text its JSON body
 * carries, in quotes.
 */
export function etagOf(updatedAt: Date | string): string {
	return `"${typeof updatedAt === "string" ? updatedAt : updatedAt.toJSON()}"`;
}

/**
 * Whether every object `schema` describes has an `updatedAt`, i.e. the entity
 * a route returns is versioned.
 */
export function declaresUpdatedAt(schema: ZodType): boolean {
	if (schema instanceof z.ZodObject) return "updatedAt" in schema.shape;
	if (schema instanceof z.ZodUnion) {
		return (schema.options as ZodType[]).every(declaresUpdatedAt);
	}
	return false;
}

/// The body of a 412, as `PreconditionFailed` serializes it.
export const preconditionFailedSchema = z
	.object({
		type: z.literal("error"),
		code: z.literal("precondition-failed"),
		status: z.literal(412),
		message: z.string(),
		timestamp: z.string(),
		updatedAt: z.string().nullable().openapi({
			description: "The row's current version, or null when it does not exist.",
		}),
	})
	.openapi("PreconditionFailed", {
		description:
			"The row is not at the version the request expected. Read it again before writing.",
	});

/// The request headers of a versioned write, for the OpenAPI document.
export function preconditionHeaders(method: "put" | "patch" | "delete") {
	const ifMatch = z.string().optional().openapi({
		description:
			'Write only if the row is at this version: its `updatedAt` in quotes, e.g. `"2026-01-01T12:00:00.000Z"`. A stale version answers 412.',
	});
	if (method !== "put") return z.object({ "If-Match": ifMatch });
	return z.object({
		"If-Match": ifMatch,
		"If-None-Match": z.literal("*").optional().openapi({
			description: "`*`: create only. A row that already exists answers 412.",
		}),
	});
}

/// The `ETag` header of a response that returns a versioned row.
export const etagResponseHeader = z.object({
	ETag: z.string().openapi({
		description: "The row's `updatedAt`, in quotes. Send it back as If-Match.",
	}),
});

//
// Utilities
//

function parseEtag(value: string): Date {
	const match = STRONG_ETAG.exec(value.trim());
	const text = match?.[1];
	const date = text ? new Date(text) : undefined;
	// The round trip refuses dates the pattern lets through, e.g. Feb 30.
	if (!date || Number.isNaN(date.getTime()) || date.toJSON() !== text) {
		throw refuse("If-Match", m.errors_precondition_if_match());
	}
	return date;
}

function refuse(header: string, message: string): InvalidData {
	return new InvalidData({ [header]: [{ code: "invalid", message }] });
}
