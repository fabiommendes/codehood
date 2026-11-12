import { expect, test } from "@playwright/test";
import { z } from "zod";
import {
	declaresUpdatedAt,
	etagOf,
	readPrecondition,
} from "@/api/registry/conditional";
import { buildOpenApiDocument } from "@/api/registry/openapi-document";
import { InvalidData } from "@/core/error";

/// `If-Match` and `If-None-Match` on the REST routes (ADR 0013): how a header
/// becomes `expectedUpdatedAt`, which values are refused, and how the OpenAPI
/// document declares them.

const ISO = "2026-03-04T05:06:07.089Z";

function headers(values: Record<string, string>): Headers {
	return new Headers(values);
}

/// The `InvalidData` that `thunk` throws, or a failed test.
function invalid(thunk: () => unknown): InvalidData {
	try {
		thunk();
	} catch (error) {
		expect(error).toBeInstanceOf(InvalidData);
		expect((error as InvalidData).status).toBe(400);
		return error as InvalidData;
	}
	throw new Error("expected InvalidData");
}

test("no header leaves the write unconditional on every method", () => {
	for (const method of ["get", "post", "put", "patch", "delete"] as const) {
		expect(readPrecondition(method, headers({}), true)).toEqual({});
		expect(readPrecondition(method, headers({}), false)).toEqual({});
	}
});

test("If-Match with a quoted ISO 8601 instant becomes that instant on PUT, PATCH and DELETE", () => {
	for (const method of ["put", "patch", "delete"] as const) {
		const { expectedUpdatedAt } = readPrecondition(
			method,
			headers({ "If-Match": `"${ISO}"` }),
			true,
		);
		expect(expectedUpdatedAt).toBeInstanceOf(Date);
		expect((expectedUpdatedAt as Date).getTime()).toBe(Date.parse(ISO));
	}
});

test("surrounding whitespace in the header is tolerated", () => {
	const { expectedUpdatedAt } = readPrecondition(
		"put",
		headers({ "If-Match": `  "${ISO}"  ` }),
		true,
	);
	expect((expectedUpdatedAt as Date).getTime()).toBe(Date.parse(ISO));
});

test("the updatedAt text of any read model, put in quotes, is accepted and keeps its milliseconds", () => {
	const instants = [
		new Date(0),
		new Date("2026-01-01T00:00:00.000Z"),
		new Date("2026-12-31T23:59:59.999Z"),
		new Date("2099-06-15T12:30:45.001Z"),
		new Date(1_700_000_000_123),
	];
	for (let i = 0; i < 200; i++) {
		instants.push(new Date(Math.floor(Math.random() * 4_102_444_800_000)));
	}
	for (const instant of instants) {
		// What a JSON body carries: `Response.json` serializes the Date.
		const text = JSON.parse(JSON.stringify({ updatedAt: instant })).updatedAt;
		const { expectedUpdatedAt } = readPrecondition(
			"patch",
			headers({ "If-Match": `"${text}"` }),
			true,
		);
		expect((expectedUpdatedAt as Date).getTime()).toBe(instant.getTime());
		expect(etagOf(instant)).toBe(`"${text}"`);
	}
});

test("If-Match refuses weak ETags, lists, `*`, missing quotes and anything but the canonical instant", () => {
	const malformed = [
		`W/"${ISO}"`,
		"*",
		`"${ISO}", "${ISO}"`,
		`"${ISO}","2026-03-04T05:06:07.090Z"`,
		ISO,
		`"${ISO}`,
		`'${ISO}'`,
		'"2026-03-04T05:06:07Z"',
		'"2026-03-04T05:06:07.08Z"',
		'"2026-03-04T05:06:07.089+00:00"',
		'"2026-03-04 05:06:07.089Z"',
		'"2026-02-30T05:06:07.089Z"',
		'"2026-13-04T05:06:07.089Z"',
		'"1772600767089"',
		'""',
		"",
	];
	for (const value of malformed) {
		const error = invalid(() =>
			readPrecondition("put", headers({ "If-Match": value }), true),
		);
		expect(Object.keys(error.errors)).toEqual(["If-Match"]);
	}
});

test("If-None-Match: * becomes null on PUT only", () => {
	expect(
		readPrecondition("put", headers({ "If-None-Match": "*" }), true),
	).toEqual({ expectedUpdatedAt: null });
	expect(
		readPrecondition("put", headers({ "If-None-Match": " * " }), true),
	).toEqual({ expectedUpdatedAt: null });
	for (const method of ["patch", "delete"] as const) {
		invalid(() =>
			readPrecondition(method, headers({ "If-None-Match": "*" }), true),
		);
	}
});

test("If-None-Match with an ETag, a list or a weak ETag is refused", () => {
	for (const value of [`"${ISO}"`, `W/"${ISO}"`, `*, "${ISO}"`, "", "**"]) {
		const error = invalid(() =>
			readPrecondition("put", headers({ "If-None-Match": value }), true),
		);
		expect(Object.keys(error.errors)).toEqual(["If-None-Match"]);
	}
});

test("If-Match and If-None-Match together are refused", () => {
	invalid(() =>
		readPrecondition(
			"put",
			headers({ "If-Match": `"${ISO}"`, "If-None-Match": "*" }),
			true,
		),
	);
});

test("a route over a row without version refuses either header, even well formed", () => {
	for (const method of ["put", "patch", "delete"] as const) {
		invalid(() =>
			readPrecondition(method, headers({ "If-Match": `"${ISO}"` }), false),
		);
	}
	invalid(() =>
		readPrecondition("put", headers({ "If-None-Match": "*" }), false),
	);
});

test("GET and POST ignore the headers: a browser revalidating its cache sends If-None-Match", () => {
	for (const method of ["get", "post"] as const) {
		expect(
			readPrecondition(
				method,
				headers({ "If-None-Match": `"${ISO}"`, "If-Match": "garbage" }),
				true,
			),
		).toEqual({});
	}
});

test("etagOf quotes the instant in the same text a JSON body carries", () => {
	expect(etagOf(new Date(ISO))).toBe(`"${ISO}"`);
	expect(etagOf(ISO)).toBe(`"${ISO}"`);
});

test("declaresUpdatedAt reads objects and unions", () => {
	const versioned = z.object({ updatedAt: z.date() });
	const plain = z.object({ slug: z.string() });
	expect(declaresUpdatedAt(versioned)).toBe(true);
	expect(declaresUpdatedAt(plain)).toBe(false);
	expect(declaresUpdatedAt(z.union([versioned, versioned]))).toBe(true);
	expect(declaresUpdatedAt(z.union([versioned, plain]))).toBe(false);
	expect(declaresUpdatedAt(versioned.array())).toBe(false);
});

type Operation = {
	parameters?: { name: string; in: string; required?: boolean }[];
	responses: Record<
		string,
		{
			headers?: Record<string, unknown>;
			content?: Record<string, { schema: { $ref?: string } }>;
		}
	>;
};

function operation(path: string, method: string): Operation {
	const doc = buildOpenApiDocument() as unknown as {
		paths: Record<string, Record<string, Operation>>;
	};
	const found = doc.paths[path]?.[method];
	if (!found) throw new Error(`no ${method} ${path}`);
	return found;
}

function headerNames(op: Operation): string[] {
	return (op.parameters ?? [])
		.filter((p) => p.in === "header")
		.map((p) => p.name)
		.sort();
}

test("the OpenAPI document declares the headers, the 412 and the ETag of a versioned route", () => {
	const course = "/api/course";
	const one = "/api/course/{discipline}/{course}";

	const put = operation(course, "put");
	expect(headerNames(put)).toEqual(["If-Match", "If-None-Match"]);
	expect(put.parameters?.every((p) => !p.required)).toBe(true);
	expect(put.responses["412"]?.content?.["application/json"]?.schema).toEqual({
		$ref: "#/components/schemas/PreconditionFailed",
	});
	expect(put.responses["200"]?.headers).toHaveProperty("ETag");

	const patch = operation(one, "patch");
	expect(headerNames(patch)).toEqual(["If-Match"]);
	expect(patch.responses).toHaveProperty("412");
	expect(patch.responses["200"]?.headers).toHaveProperty("ETag");

	const del = operation(one, "delete");
	expect(headerNames(del)).toEqual(["If-Match"]);
	expect(del.responses).toHaveProperty("412");

	expect(operation(one, "get").responses["200"]?.headers).toHaveProperty(
		"ETag",
	);
});

test("the OpenAPI document declares nothing conditional on a route without version", () => {
	const patch = operation("/api/edition/{slug}", "patch");
	expect(headerNames(patch)).toEqual([]);
	expect(patch.responses).not.toHaveProperty("412");
	expect(patch.responses["200"]?.headers).toBeUndefined();
});

test("the manual routes the CLI writes declare the headers too", () => {
	const repository = "/api/course/{discipline}/{course}/repository";
	expect(headerNames(operation(repository, "put"))).toEqual([
		"If-Match",
		"If-None-Match",
	]);
	expect(headerNames(operation(`${repository}/{slug}`, "delete"))).toEqual([
		"If-Match",
	]);
	const rubricItem =
		"/api/course/{discipline}/{course}/exam/{slug}/question/{question}/rubric/item/{key}";
	expect(headerNames(operation(rubricItem, "patch"))).toEqual(["If-Match"]);
	expect(headerNames(operation(rubricItem, "delete"))).toEqual(["If-Match"]);
});
