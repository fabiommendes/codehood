import type { ZodType } from "zod";
import { InvalidData } from "@/core/error";
import type { InvalidDataCode } from "@/core/error-response";
import { MAX_UPLOAD_BYTES } from "@/core/schemas";
import { hashBytes } from "@/utils/content-hash";
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

/// Checks the content type and size of a `multipart/form-data` request and
/// parses it.
async function readForm(request: Request, maxBytes: number): Promise<FormData> {
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
	return form;
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
	const form = await readForm(request, maxBytes);

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

/// What {@link readJsonMultipart} hands the route: the parsed `json` part and
/// the bytes of every file part, keyed by their verified sha-256.
export type JsonMultipart = {
	json: unknown;
	files: Record<string, Buffer>;
};

/**
 * Reads a `multipart/form-data` body made of one text part `json`, holding
 * the JSON body, and file parts named after the sha-256 of their bytes.
 *
 * The size limit is the one {@link readMultipart} applies. The `json` part is
 * not validated: the caller runs the route's `in` schema on it.
 *
 * @throws {@link InvalidData} With status 413 past `maxBytes`, and 400 when
 * the body is not multipart, the `json` part is missing, repeated or not
 * JSON, a text part other than `json` is present, or a file part's name is
 * not the sha-256 of its bytes.
 */
export async function readJsonMultipart(
	request: Request,
	maxBytes: number = MAX_UPLOAD_BYTES,
): Promise<JsonMultipart> {
	const form = await readForm(request, maxBytes);
	const files: Record<string, Buffer> = Object.create(null);
	let text: string | undefined;
	for (const [key, value] of form.entries()) {
		if (typeof value === "string") {
			if (key !== "json") {
				throw reject(`Unexpected text part "${key}"`, 400);
			}
			if (text !== undefined) throw reject('Part "json" is repeated', 400);
			text = value;
			continue;
		}
		if (!SHA256.test(key)) {
			throw reject(`File part "${key}" is not named by a sha-256`, 400);
		}
		const bytes = Buffer.from(await value.arrayBuffer());
		if (hashBytes(bytes) !== key) {
			throw reject(`File part "${key}" does not match its sha-256`, 400);
		}
		files[key] = bytes;
	}
	if (text === undefined) throw reject('Missing the "json" part', 400);
	try {
		return { json: JSON.parse(text), files };
	} catch {
		throw reject('Part "json" is not valid JSON', 400);
	}
}

/// A lowercase sha-256, the name of a file part.
const SHA256 = /^[0-9a-f]{64}$/;
