import { InvalidData } from "@/core/error";

const MAX_ENVELOPE_BYTES = 1024 * 1024;

/**
 * Reads a JSON-RPC envelope with a byte limit independent of Content-Length.
 *
 * @throws {InvalidData} When the envelope exceeds 1 MiB.
 * @throws {SyntaxError} When the body is not JSON.
 */
export async function readEnvelope(request: Request): Promise<unknown> {
	const reader = request.body?.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	if (reader) {
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				size += value.byteLength;
				if (size > MAX_ENVELOPE_BYTES) {
					await reader.cancel();
					throw new InvalidData(
						{
							$: [{ code: "too-long", message: "RPC envelope exceeds 1 MiB." }],
						},
						{ status: 413 },
					);
				}
				chunks.push(value);
			}
		} finally {
			reader.releaseLock();
		}
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
