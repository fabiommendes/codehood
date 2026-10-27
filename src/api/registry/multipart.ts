import type { ZodType } from "zod";
import { InvalidData } from "@/core/error";
import type { InvalidDataCode } from "@/core/error-response";
import { MAX_UPLOAD_BYTES } from "@/core/schemas";
import { coerceForSchema } from "@/utils/query-coerce";

/// Builds the single-field error shared by every rejection in this module.
function reject(
	message: string,
	status: number,
	code: InvalidDataCode = "invalid",
) {
	return new InvalidData({ $: [{ code, message }] }, { message, status });
}

function tooLarge(maxBytes: number) {
	return reject(`Request body exceeds ${maxBytes} bytes`, 413, "too-long");
}

/// Buffers the request body, aborting with 413 once it passes `maxBytes`.
async function readLimited(request: Request, maxBytes: number) {
	const chunks: Uint8Array[] = [];
	let total = 0;
	if (!request.body) return new Uint8Array();
	const reader = request.body.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel();
			throw tooLarge(maxBytes);
		}
		chunks.push(value);
	}
	return Buffer.concat(chunks);
}

/**
 * Reads a `multipart/form-data` request into the raw object a route's `in`
 * schema validates.
 *
 * Checks `Content-Length` before touching the body. The body is then read
 * through a byte counter that aborts as soon as it passes `maxBytes`, whatever
 * the header says or when it is missing. Then every `File` part
 * becomes a `Buffer` under its part name, and the text parts go through
 * `coerceForSchema(schema, ...)`, so numbers, booleans, dates, arrays and
 * bracketed keys arrive as they would in a JSON body. The result is not
 * validated: the caller still runs `schema.safeParse` on it.
 *
 * @throws {@link InvalidData} With status 413 when `Content-Length` or the bytes
 * actually read exceed `maxBytes`, and 400 when the body is not `multipart/form-data` or a file part name repeats or is also used by
 * a text part.
 */
export async function readMultipart(
	request: Request,
	schema: ZodType,
	maxBytes: number = MAX_UPLOAD_BYTES,
): Promise<Record<string, unknown>> {
	const type = request.headers.get("content-type") ?? "";
	if (!type.toLowerCase().startsWith("multipart/form-data")) {
		throw reject("Expected a multipart/form-data body", 400);
	}
	const header = request.headers.get("content-length")?.trim();
	if (header && /^\d+$/.test(header) && Number(header) > maxBytes) {
		throw tooLarge(maxBytes);
	}

	let form: FormData;
	try {
		const bytes = await readLimited(request, maxBytes);
		form = await new Response(bytes, {
			headers: { "content-type": type },
		}).formData();
	} catch (error) {
		if (error instanceof InvalidData) throw error;
		throw reject("Malformed multipart/form-data body", 400);
	}

	const files: Record<string, Buffer> = Object.create(null);
	const text: Record<string, string | string[]> = Object.create(null);
	for (const [key, value] of form.entries()) {
		if (typeof value === "string") {
			const prev = text[key];
			text[key] =
				prev === undefined
					? value
					: Array.isArray(prev)
						? [...prev, value]
						: [prev, value];
		} else {
			if (Object.hasOwn(files, key)) {
				throw reject(`File part "${key}" is repeated`, 400);
			}
			files[key] = Buffer.from(await value.arrayBuffer());
		}
	}
	for (const key of Object.keys(files)) {
		if (Object.hasOwn(text, key)) {
			throw reject(`Part "${key}" is both a file and a text field`, 400);
		}
	}
	return { ...coerceForSchema(schema, text), ...files };
}
