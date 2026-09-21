import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { buildOpenApiDocument } from "@/api/registry/openapi-document";

const COLLECTION = "test/bruno";

const document = buildOpenApiDocument();

type Schema = { properties?: Record<string, Schema>; required?: string[] } & {
	enum?: unknown[];
	$ref?: string;
};

/// Resolves a `$ref` against the document's component schemas.
function deref(schema: unknown): Schema | undefined {
	if (!schema || typeof schema !== "object") return undefined;
	const ref = (schema as Schema).$ref;
	if (!ref) return schema as Schema;
	return document.components?.schemas?.[
		ref.replace("#/components/schemas/", "")
	] as Schema | undefined;
}

/// Every `.yml` under `dir`, recursively.
function requestFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((entry) => {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) return requestFiles(path);
		return path.endsWith(".yml") ? [path] : [];
	});
}

interface BrunoRequest {
	file: string;
	method: string;
	pathname: string;
	query: URLSearchParams;
	body?: Record<string, unknown>;
}

/// Reads the method, URL and JSON body out of a Bruno request file, or `undefined` for a folder file.
function parse(file: string): BrunoRequest | undefined {
	const text = readFileSync(file, "utf8");
	const method = text.match(/^ {2}method: (\w+)/m)?.[1];
	const url = text.match(/^ {2}url: (.+)$/m)?.[1];
	if (!method || !url) return undefined;

	const { pathname, searchParams } = new URL(url);
	const raw = text.match(/ {4}data: \|-\n([\s\S]*?)\n {2}auth:/)?.[1];
	return {
		file,
		method: method.toLowerCase(),
		// A trailing slash addresses the collection, not an empty path parameter.
		pathname: pathname.replace(/\/$/, ""),
		query: searchParams,
		body: raw?.trim() ? JSON.parse(raw.replace(/^ {6}/gm, "")) : undefined,
	};
}

/// The OpenAPI path template a concrete pathname addresses.
function template(pathname: string): string | undefined {
	const segments = pathname.split("/");
	return Object.keys(document.paths ?? {}).find((candidate) => {
		const parts = candidate.split("/");
		return (
			parts.length === segments.length &&
			parts.every((part, i) => part.startsWith("{") || part === segments[i])
		);
	});
}

const requests = requestFiles(COLLECTION)
	.sort()
	.flatMap((file) => parse(file) ?? []);

test("the Bruno collection is not empty", () => {
	expect(requests.length).toBeGreaterThan(20);
});

for (const request of requests) {
	const { file, method, pathname, query, body } = request;

	test(`${file} addresses a registered route`, () => {
		const path = template(pathname);
		expect(path, `no route matches ${pathname}`).toBeDefined();

		const operations = document.paths?.[path as string] ?? {};
		expect(
			Object.keys(operations),
			`${method.toUpperCase()} ${path}`,
		).toContain(method);
	});

	test(`${file} sends only parameters and fields the route declares`, () => {
		const path = template(pathname) as string;
		const operation = (
			document.paths?.[path] as Record<string, Record<string, unknown>>
		)?.[method];
		// The companion test above is the one that reports an unregistered route.
		if (!operation) return;

		const declared = new Set(
			((operation.parameters ?? []) as { name?: string }[]).map((p) => p.name),
		);
		for (const name of new Set(query.keys())) {
			expect(declared, `query parameter "${name}"`).toContain(name);
		}

		if (!body) return;
		const schema = deref(
			(
				operation.requestBody as {
					content?: Record<string, { schema?: unknown }>;
				}
			)?.content?.["application/json"]?.schema,
		);
		expect(
			schema,
			`${method.toUpperCase()} ${path} takes no body`,
		).toBeDefined();

		const properties = schema?.properties ?? {};
		for (const field of Object.keys(body)) {
			expect(Object.keys(properties), `body field "${field}"`).toContain(field);
		}
		for (const field of schema?.required ?? []) {
			expect(Object.keys(body), `required field "${field}"`).toContain(field);
		}
		for (const [field, value] of Object.entries(body)) {
			const allowed = properties[field]?.enum;
			if (allowed) expect(allowed, `body field "${field}"`).toContain(value);
		}
	});
}
