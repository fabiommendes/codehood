import type { ZodType } from "zod";
import { MAX_UPLOAD_BYTES } from "@/core/schemas";

/**
 * Reads a `multipart/form-data` request into the raw object a route's `in`
 * schema validates.
 *
 * Checks `Content-Length` before touching the body. Then every `File` part
 * becomes a `Buffer` under its part name, and the text parts go through
 * `coerceForSchema(schema, ...)`, so numbers, booleans, dates, arrays and
 * bracketed keys arrive as they would in a JSON body. The result is not
 * validated: the caller still runs `schema.safeParse` on it.
 *
 * @throws {@link InvalidData} With status 413 when `Content-Length` exceeds
 * `maxBytes`, 411 when it is missing or not a number, and 400 when the body
 * is not `multipart/form-data` or a file part name repeats or is also used by
 * a text part.
 */
export async function readMultipart(
	_request: Request,
	_schema: ZodType,
	_maxBytes: number = MAX_UPLOAD_BYTES,
): Promise<Record<string, unknown>> {
	throw new Error("not implemented");
}
