import { expect, test } from "@playwright/test";
import { z } from "zod";
import { formToInput } from "@/forms/form-to-input";
// Not exported by the package, hence the file path. A failure here means the
// Astro update changed how form actions read FormData.
import { formDataToObject } from "../node_modules/astro/dist/actions/runtime/server.js";

function form(entries: [string, string][]): FormData {
	const data = new FormData();
	for (const [key, value] of entries) data.append(key, value);
	return data;
}

const cases: [string, z.ZodObject, [string, string][]][] = [
	["string", z.object({ a: z.string() }), [["a", "x"]]],
	["empty required string", z.object({ a: z.string() }), [["a", ""]]],
	["missing required string", z.object({ a: z.string() }), []],
	[
		"empty optional string",
		z.object({ a: z.string().optional() }),
		[["a", ""]],
	],
	["nullable string", z.object({ a: z.string().nullable() }), [["a", ""]]],
	["number", z.object({ n: z.number() }), [["n", "42"]]],
	["empty number", z.object({ n: z.number() }), [["n", ""]]],
	["optional number", z.object({ n: z.number().optional() }), []],
	["boolean true", z.object({ b: z.boolean() }), [["b", "true"]]],
	["boolean false", z.object({ b: z.boolean() }), [["b", "false"]]],
	["boolean present", z.object({ b: z.boolean() }), [["b", "on"]]],
	["boolean absent", z.object({ b: z.boolean() }), []],
	["coerce date", z.object({ d: z.coerce.date() }), [["d", "2026-03-04"]]],
	["empty coerce date", z.object({ d: z.coerce.date() }), [["d", ""]]],
	["enum", z.object({ e: z.enum(["a", "b"]) }), [["e", "b"]]],
	["default absent", z.object({ n: z.number().default(7) }), []],
	["default present", z.object({ n: z.number().default(7) }), [["n", "3"]]],
	["default fn", z.object({ s: z.string().default(() => "z") }), []],
	[
		"string array",
		z.object({ t: z.array(z.string()) }),
		[
			["t", "a"],
			["t", "b"],
		],
	],
	[
		"number array",
		z.object({ t: z.array(z.number()) }),
		[
			["t", "1"],
			["t", "2"],
		],
	],
	[
		"boolean array",
		z.object({ t: z.array(z.boolean()) }),
		[
			["t", "true"],
			["t", "false"],
			["t", "x"],
		],
	],
	["empty array", z.object({ t: z.array(z.string()) }), []],
	[
		"nested object",
		z.object({ o: z.object({ x: z.string(), y: z.number() }) }),
		[
			["o.x", "hi"],
			["o.y", "5"],
		],
	],
	["absent nested object", z.object({ o: z.object({ x: z.string() }) }), []],
	[
		"absent nullable nested object",
		z.object({ o: z.object({ x: z.string() }).nullable() }),
		[],
	],
	[
		"piped field",
		z.object({ p: z.string().transform((s) => s.length) }),
		[["p", "abc"]],
	],
	[
		"catchall",
		z.object({ a: z.string() }).catchall(z.string()),
		[
			["a", "1"],
			["extra", "2"],
		],
	],
	[
		"mixed form",
		z.object({
			name: z.string().min(1),
			age: z.number().optional(),
			agree: z.boolean(),
			role: z.enum(["x", "y"]).default("x"),
		}),
		[
			["name", "Ana"],
			["age", ""],
			["agree", "on"],
		],
	],
];

for (const [name, schema, entries] of cases) {
	test(`matches Astro: ${name}`, () => {
		const data = form(entries);
		expect(formToInput(schema, data)).toEqual(formDataToObject(data, schema));
	});
}

test("discriminated unions pick the matching option like Astro", () => {
	const schema = z.discriminatedUnion("kind", [
		z.object({ kind: z.literal("a"), x: z.string() }),
		z.object({ kind: z.literal("b"), y: z.number() }),
	]);
	const data = form([
		["kind", "b"],
		["y", "3"],
		["x", "ignored"],
	]);
	expect(formToInput(schema, data)).toEqual({ kind: "b", y: 3 });
});

test("a non-object schema returns the FormData untouched", () => {
	const data = form([["a", "1"]]);
	expect(formToInput(z.string(), data)).toBe(data);
});

test("a piped object schema is unwrapped", () => {
	const schema = z.object({ n: z.number() }).transform((v) => v);
	expect(formToInput(schema, form([["n", "4"]]))).toEqual({ n: 4 });
});
