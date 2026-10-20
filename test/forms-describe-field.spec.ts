import { expect, test } from "@playwright/test";
import { z } from "zod";
import {
	describeField,
	describeFields,
	humanize,
} from "@/forms/describe-field";
import "@/forms/meta";
import { buildOpenApiDocument } from "@/api/registry/openapi-document";
import {
	buildOpenRpcDocument,
	jsonSchemaOf,
} from "@/rpc/registry/openrpc-document";

test("humanize splits camelCase and snake_case", () => {
	expect(humanize("slug")).toBe("Slug");
	expect(humanize("firstName")).toBe("First name");
	expect(humanize("start_date")).toBe("Start date");
});

test("string checks become attributes", () => {
	const spec = describeField(
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
		label: "Slug",
		attrs: { minlength: 2, maxlength: 8, pattern: "[a-z]+" },
	});
});

test("pattern is omitted when HTML would read it differently", () => {
	for (const regex of [/[a-z]+/, /^[a-z]+$/i, /^(?<a>x)\k<a>$/u, /^a\$/]) {
		expect(
			describeField("x", z.string().regex(regex)).attrs.pattern,
		).toBeUndefined();
	}
});

test("string formats pick the kind", () => {
	expect(describeField("x", z.email()).kind).toBe("email");
	expect(describeField("x", z.url()).kind).toBe("url");
	expect(describeField("x", z.iso.date()).kind).toBe("date");
	expect(describeField("x", z.iso.datetime()).kind).toBe("datetime");
	expect(
		describeField("x", z.string().meta({ form: { widget: "textarea" } })).kind,
	).toBe("textarea");
	expect(
		describeField("x", z.string().meta({ form: { widget: "password" } })).attrs
			.type,
	).toBe("password");
});

test("numbers carry min, max and step", () => {
	expect(describeField("n", z.number().int().min(1).max(10)).attrs).toEqual({
		min: 1,
		max: 10,
		step: 1,
	});
	expect(describeField("n", z.number()).attrs).toEqual({});
	expect(describeField("n", z.number().multipleOf(0.5)).attrs.step).toBe(0.5);
});

test("dates, booleans and enums", () => {
	const date = describeField(
		"d",
		z.coerce.date().min(new Date("2026-01-02T10:00:00Z")),
	);
	expect(date).toMatchObject({ kind: "date", attrs: { min: "2026-01-02" } });
	expect(describeField("b", z.boolean()).kind).toBe("boolean");
	expect(
		describeField("role", z.enum(["admin", "student_user"])),
	).toMatchObject({
		kind: "enum",
		options: [
			{ value: "admin", label: "Admin" },
			{ value: "student_user", label: "Student user" },
		],
	});
});

test("wrappers unwrap and decide required", () => {
	expect(describeField("x", z.string()).required).toBe(true);
	expect(describeField("x", z.string().optional()).required).toBe(false);
	expect(describeField("x", z.string().nullable()).required).toBe(false);
	expect(describeField("x", z.number().default(3)).required).toBe(false);
	expect(
		describeField(
			"x",
			z.string().transform((s) => s.length),
		).kind,
	).toBe("text");
	expect(
		describeField("x", z.string().max(3).optional().nullable()).attrs.maxlength,
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
	expect(describeField("x", inner).placeholder).toBe("cs102");
	expect(describeField("x", outer).placeholder).toBe("cs102");
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
	expect(describeField("fooBar", z.string())).toMatchObject({
		label: "Foo bar",
	});
	expect(describeField("fooBar", z.string()).hint).toBeUndefined();
});

test("unsupported types throw", () => {
	expect(() => describeField("x", z.array(z.string()))).toThrow(/array/);
	expect(() => describeField("x", z.object({}))).toThrow(
		/Write the field by hand/,
	);
	expect(() => describeField("x", z.union([z.string(), z.number()]))).toThrow();
});

test("describeFields follows shape order and applies overrides", () => {
	const schema = z.object({ b: z.string(), a: z.number() });
	const specs = describeFields(schema, { a: { label: "Alpha" } });
	expect(specs.map((s) => [s.name, s.label])).toEqual([
		["b", "B"],
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
