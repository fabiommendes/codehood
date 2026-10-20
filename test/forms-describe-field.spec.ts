import { expect, test } from "@playwright/test";
import { z } from "zod";
import { describeField, describeFields } from "@/forms/describe-field";
import "@/forms/meta";
import { buildOpenApiDocument } from "@/api/registry/openapi-document";
import {
	buildOpenRpcDocument,
	jsonSchemaOf,
} from "@/rpc/registry/openrpc-document";

/// `describeField` with a label supplied, for tests about anything but labels.
const field = (
	name: string,
	schema: Parameters<typeof describeField>[1],
	override: Parameters<typeof describeField>[2] = {},
) => describeField(name, schema, { label: name, ...override });

test("string checks become attributes", () => {
	const spec = field(
		"slug",
		z
			.string()
			.min(2)
			.max(8)
			.regex(/^[a-z]+$/),
	);
	expect(spec).toMatchObject({
		kind: "text",
		required: true,
		label: "slug",
		attrs: { minlength: 2, maxlength: 8, pattern: "[a-z]+" },
	});
});

test("pattern is omitted when HTML would read it differently", () => {
	for (const regex of [/[a-z]+/, /^[a-z]+$/i, /^(?<a>x)\k<a>$/u, /^a\$/]) {
		expect(field("x", z.string().regex(regex)).attrs.pattern).toBeUndefined();
	}
});

test("string formats pick the kind", () => {
	expect(field("x", z.email()).kind).toBe("email");
	expect(field("x", z.url()).kind).toBe("url");
	expect(field("x", z.iso.date()).kind).toBe("date");
	expect(field("x", z.iso.datetime()).kind).toBe("datetime");
	expect(
		field("x", z.string().meta({ form: { widget: "textarea" } })).kind,
	).toBe("textarea");
	expect(
		field("x", z.string().meta({ form: { widget: "password" } })).attrs.type,
	).toBe("password");
});

test("numbers carry min, max and step", () => {
	expect(field("n", z.number().int().min(1).max(10)).attrs).toEqual({
		min: 1,
		max: 10,
		step: 1,
	});
	expect(field("n", z.number()).attrs).toEqual({});
	expect(field("n", z.number().multipleOf(0.5)).attrs.step).toBe(0.5);
});

test("dates, booleans and enums", () => {
	const date = field(
		"d",
		z.coerce.date().min(new Date("2026-01-02T10:00:00Z")),
	);
	expect(date).toMatchObject({ kind: "date", attrs: { min: "2026-01-02" } });
	expect(field("b", z.boolean()).kind).toBe("boolean");
	expect(
		field("role", z.enum(["admin", "student_user"]), {
			options: { admin: "Admin", student_user: "Student user" },
		}),
	).toMatchObject({
		kind: "enum",
		options: [
			{ value: "admin", label: "Admin" },
			{ value: "student_user", label: "Student user" },
		],
	});
});

test("wrappers unwrap and decide required", () => {
	expect(field("x", z.string()).required).toBe(true);
	expect(field("x", z.string().optional()).required).toBe(false);
	expect(field("x", z.string().nullable()).required).toBe(false);
	expect(field("x", z.number().default(3)).required).toBe(false);
	expect(
		field(
			"x",
			z.string().transform((s) => s.length),
		).kind,
	).toBe("text");
	expect(
		field("x", z.string().max(3).optional().nullable()).attrs.maxlength,
	).toBe(3);
});

test("meta is found through wrappers, inner or outer", () => {
	const inner = z
		.string()
		.meta({ form: { placeholder: "cs102" } })
		.optional();
	const outer = z
		.string()
		.optional()
		.meta({ form: { placeholder: "cs102" } });
	expect(field("x", inner).placeholder).toBe("cs102");
	expect(field("x", outer).placeholder).toBe("cs102");
});

test("label and hint precedence", () => {
	const schema = z.string().meta({
		title: "Title",
		description: "Description",
		form: { label: "Form label", hint: "Form hint" },
	});
	expect(describeField("x", schema, { label: "O", hint: "H" })).toMatchObject({
		label: "O",
		hint: "H",
	});
	expect(describeField("x", schema)).toMatchObject({
		label: "Form label",
		hint: "Form hint",
	});
	const apiOnly = z
		.string()
		.meta({ title: "Title", description: "Description" });
	expect(describeField("x", apiOnly)).toMatchObject({
		label: "Title",
		hint: "Description",
	});
	expect(describeField("x", z.string(), { label: "L" }).hint).toBeUndefined();
});

test("a field with no label throws, naming the field", () => {
	expect(() => describeField("fooBar", z.string())).toThrow(/"fooBar".*label/);
});

test("an enum value with no option label throws", () => {
	expect(() => describeField("role", z.enum(["a"]), { label: "R" })).toThrow(
		/"role".*"a"/,
	);
});

test("unsupported types throw", () => {
	expect(() => field("x", z.array(z.string()))).toThrow(/array/);
	expect(() => field("x", z.object({}))).toThrow(/Write the field by hand/);
	expect(() => field("x", z.union([z.string(), z.number()]))).toThrow();
});

test("describeFields follows shape order and applies overrides", () => {
	const schema = z.object({ b: z.string(), a: z.number() });
	const specs = describeFields(schema, {
		a: { label: "Alpha" },
		b: { label: "b" },
	});
	expect(specs.map((s) => [s.name, s.label])).toEqual([
		["b", "b"],
		["a", "Alpha"],
	]);
});

test("the form meta key never reaches generated JSON Schema or OpenRPC", () => {
	const schema = z.object({
		slug: z.string().meta({ form: { placeholder: "cs102" }, description: "d" }),
	});
	const json = jsonSchemaOf(schema, "input");
	expect(JSON.stringify(json)).not.toContain('"form"');
	expect(JSON.stringify(json)).toContain('"description":"d"');
	expect(JSON.stringify(buildOpenRpcDocument())).not.toContain('"form"');
});

test("the form meta key never reaches the OpenAPI document", () => {
	const document = buildOpenApiDocument();
	expect(JSON.stringify(document)).not.toContain('"form"');
});
