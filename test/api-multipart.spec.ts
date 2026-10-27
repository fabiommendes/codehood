import { expect, test } from "@playwright/test";
import type { APIContext } from "astro";
import { z } from "zod";
import { readMultipart } from "@/api/registry/multipart";
import { buildOpenApiDocument } from "@/api/registry/openapi-document";
import { openApiRequest, POST, registry } from "@/api/registry/route";
import { InvalidData } from "@/core/error";
import { MAX_UPLOAD_BYTES } from "@/core/schemas";
import { buffer } from "@/core/schemas/base";

/// Multipart upload: the endpoint reads file and text parts, the OpenAPI
/// document describes them, and an oversized request is refused unread.

const TEST_PATH = "/api/__test/multipart";
const SEVENTEEN_MB = 17 * 1024 * 1024;

const uploadIn = z.object({
	file: buffer,
	count: z.number(),
	active: z.boolean(),
	tags: z.array(z.string()).optional(),
});

const uploadOut = z.object({
	isBuffer: z.boolean(),
	size: z.number(),
	text: z.string(),
	count: z.number(),
	active: z.boolean(),
	tags: z.array(z.string()),
});

/// `registry.definitions` is a getter that returns a fresh copy, so the
/// cleanup has to reach the array it copies.
const definitions = (registry as unknown as { _definitions: unknown[] })
	._definitions;
const definitionsBefore = [...definitions];

const upload = POST(TEST_PATH, {
	isPublic: true,
	inMultipart: true,
	in: uploadIn,
	out: uploadOut,
	handler: async ({ body }) => ({
		isBuffer: Buffer.isBuffer(body.file),
		size: body.file.length,
		text: body.file.toString("utf8"),
		count: body.count,
		active: body.active,
		tags: body.tags ?? [],
	}),
});

test.afterAll(() => {
	definitions.splice(0, definitions.length, ...definitionsBefore);
});

function contextFor(request: Request): APIContext {
	return {
		locals: {},
		request,
		params: {},
		cookies: {},
	} as unknown as APIContext;
}

function postForm(form: FormData, headers?: HeadersInit): Request {
	return new Request(`http://test${TEST_PATH}`, {
		method: "POST",
		body: form,
		headers,
	});
}

/// A request that claims `length` bytes and fails the test if its body is read.
function unreadableBody(length: number | undefined): Request {
	const body = new ReadableStream({
		pull() {
			throw new Error("the body must not be read");
		},
	});
	const headers: Record<string, string> = {
		"Content-Type": "multipart/form-data; boundary=xx",
	};
	if (length !== undefined) headers["Content-Length"] = String(length);
	return new Request(`http://test${TEST_PATH}`, {
		method: "POST",
		body,
		headers,
		duplex: "half",
	} as RequestInit);
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	throw new Error("expected the promise to reject");
}

test.describe("endpoint with inMultipart", () => {
	test("receives file parts as Buffer and coerces text parts by the schema", async () => {
		const form = new FormData();
		form.set("file", new File(["hello é"], "a.txt", { type: "text/plain" }));
		form.set("count", "3");
		form.set("active", "true");
		form.append("tags", "x");
		form.append("tags", "y");

		const response = await upload.view(contextFor(postForm(form)));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			isBuffer: true,
			size: Buffer.byteLength("hello é"),
			text: "hello é",
			count: 3,
			active: true,
			tags: ["x", "y"],
		});
	});

	test("keeps the bytes of a binary file intact", async () => {
		const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
		const form = new FormData();
		form.set("file", new File([bytes], "b.bin"));
		form.set("count", "1");
		form.set("active", "false");

		const response = await upload.view(contextFor(postForm(form)));

		expect(response.status).toBe(200);
		expect((await response.json()).size).toBe(256);
	});

	test("answers 400 when a text part fails the schema", async () => {
		const form = new FormData();
		form.set("file", new File(["x"], "a.txt"));
		form.set("count", "not a number");
		form.set("active", "true");

		const response = await upload.view(contextFor(postForm(form)));

		expect(response.status).toBe(400);
		expect((await response.json()).code).toBe("invalid-data");
	});

	test("answers 400 when a required file part is missing", async () => {
		const form = new FormData();
		form.set("count", "1");
		form.set("active", "true");

		const response = await upload.view(contextFor(postForm(form)));

		expect(response.status).toBe(400);
	});

	test("answers 413 for a Content-Length above 16 MB without reading the body", async () => {
		const response = await upload.view(
			contextFor(unreadableBody(SEVENTEEN_MB)),
		);

		expect(response.status).toBe(413);
		expect((await response.json()).code).toBe("invalid-data");
	});
});

test.describe("readMultipart", () => {
	const schema = z.object({ file: buffer, n: z.number() });

	test("returns files as Buffer and text coerced, without validating", async () => {
		const form = new FormData();
		form.set("file", new File(["abc"], "a.txt"));
		form.set("n", "7");

		const raw = await readMultipart(postForm(form), schema);

		expect(Buffer.isBuffer(raw.file)).toBe(true);
		expect((raw.file as Buffer).toString()).toBe("abc");
		expect(raw.n).toBe(7);
	});

	test("accepts a Content-Length exactly at the limit", async () => {
		const form = new FormData();
		form.set("file", new File(["abc"], "a.txt"));
		form.set("n", "7");
		const sent = postForm(form);
		const request = new Request(sent.url, {
			method: "POST",
			body: await sent.arrayBuffer(),
			headers: {
				"Content-Type": sent.headers.get("content-type") ?? "",
				"Content-Length": String(MAX_UPLOAD_BYTES),
			},
		});

		const raw = await readMultipart(request, schema);

		expect(raw.n).toBe(7);
	});

	test("refuses one byte above a custom limit with 413", async () => {
		const error = await rejection(
			readMultipart(unreadableBody(101), schema, 100),
		);

		expect(error).toBeInstanceOf(InvalidData);
		expect((error as InvalidData).status).toBe(413);
	});

	test("without Content-Length, stops reading past the limit with 413", async () => {
		let pulled = 0;
		const body = new ReadableStream({
			pull(controller) {
				pulled += 64;
				controller.enqueue(new Uint8Array(64));
			},
		});
		const request = new Request(`http://test${TEST_PATH}`, {
			method: "POST",
			body,
			headers: { "Content-Type": "multipart/form-data; boundary=xx" },
			duplex: "half",
		} as RequestInit);

		const error = await rejection(readMultipart(request, schema, 100));

		expect(error).toBeInstanceOf(InvalidData);
		expect((error as InvalidData).status).toBe(413);
		expect(pulled).toBeLessThanOrEqual(100 + 64 * 4);
	});

	test("answers 400 when the body is not multipart/form-data", async () => {
		const request = new Request(`http://test${TEST_PATH}`, {
			method: "POST",
			body: JSON.stringify({ n: 1 }),
			headers: { "Content-Type": "application/json" },
		});

		const error = await rejection(readMultipart(request, schema));

		expect(error).toBeInstanceOf(InvalidData);
		expect((error as InvalidData).status).toBe(400);
	});

	test("answers 400 when a file part name repeats", async () => {
		const form = new FormData();
		form.append("file", new File(["a"], "a.txt"));
		form.append("file", new File(["b"], "b.txt"));
		form.set("n", "1");

		const error = await rejection(readMultipart(postForm(form), schema));

		expect(error).toBeInstanceOf(InvalidData);
		expect((error as InvalidData).status).toBe(400);
	});

	test("answers 400 when a file part and a text part share a name", async () => {
		const form = new FormData();
		form.append("file", new File(["a"], "a.txt"));
		form.append("file", "text");
		form.set("n", "1");

		const error = await rejection(readMultipart(postForm(form), schema));

		expect(error).toBeInstanceOf(InvalidData);
		expect((error as InvalidData).status).toBe(400);
	});
});

test.describe("OpenAPI", () => {
	test("openApiRequest documents the body as multipart/form-data only", () => {
		const request = openApiRequest("post", "/api/x", {
			in: uploadIn,
			inMultipart: true,
		});

		const content = request?.body?.content ?? {};
		expect(Object.keys(content)).toEqual(["multipart/form-data"]);
		expect(content["multipart/form-data"]).toHaveProperty("schema");
	});

	test("openApiRequest keeps application/json without inMultipart", () => {
		const request = openApiRequest("post", "/api/x", { in: uploadIn });

		expect(Object.keys(request?.body?.content ?? {})).toEqual([
			"application/json",
		]);
	});

	test("openApiRequest declares a string parameter per dynamic segment", () => {
		const request = openApiRequest("post", "/api/x/[slug]/files", {
			in: uploadIn,
			inMultipart: true,
		});

		expect(request?.params).toBeDefined();
		expect(Object.keys(request?.body?.content ?? {})).toEqual([
			"multipart/form-data",
		]);
	});

	test("openApiRequest has no request for a route without input or params", () => {
		expect(openApiRequest("post", "/api/x", {})).toBeUndefined();
	});

	for (const method of ["get", "delete"] as const) {
		test(`openApiRequest rejects inMultipart on ${method}`, () => {
			expect(() =>
				openApiRequest(method, "/api/x", { in: uploadIn, inMultipart: true }),
			).toThrow(/multipart/i);
		});
	}

	test("openApiRequest rejects inMultipart without an input schema", () => {
		expect(() =>
			openApiRequest("post", "/api/x", { inMultipart: true }),
		).toThrow(/multipart|in/i);
	});

	test("the document shows the registered endpoint as multipart/form-data", () => {
		const document = buildOpenApiDocument();

		const content = document.paths?.[TEST_PATH]?.post?.requestBody;
		expect(content).toBeDefined();
		const media = (content as { content: Record<string, unknown> }).content;
		expect(Object.keys(media)).toEqual(["multipart/form-data"]);
	});
});
