import { expect, test } from "@playwright/test";
import { z } from "zod";
import { installErrorMap } from "@/forms/error-map";

function messages(schema: z.ZodType, input: unknown): string[] {
	const result = schema.safeParse(input);
	return result.success ? [] : result.error.issues.map((i) => i.message);
}

test.beforeAll(() => {
	installErrorMap();
	installErrorMap();
});

test("null and undefined are Required", () => {
	expect(messages(z.string(), null)).toEqual(["Required"]);
	expect(messages(z.number(), undefined)).toEqual(["Required"]);
	expect(messages(z.enum(["a"]), null)).toEqual(["Required"]);
	expect(messages(z.object({ a: z.string() }), { a: null })).toEqual([
		"Required",
	]);
});

test("a wrong type that is not empty keeps zod's text", () => {
	expect(messages(z.string(), 3)[0]).toMatch(/expected string/i);
});

test("string length and format messages", () => {
	expect(messages(z.string().min(1), "")).toEqual(["Required"]);
	expect(messages(z.string().min(3), "a")).toEqual([
		"Must be at least 3 characters",
	]);
	expect(messages(z.string().max(2), "abc")).toEqual([
		"Must be at most 2 characters",
	]);
	expect(messages(z.email(), "nope")).toEqual(["Enter a valid email address"]);
});

test("a message set on the schema wins over the map", () => {
	expect(messages(z.string("custom"), null)).toEqual(["custom"]);
});

test("installing twice keeps a single map", () => {
	const before = z.config().customError;
	installErrorMap();
	expect(z.config().customError).toBe(before);
});

test("a coerced date accepts null: documented limit, no issue is raised", () => {
	expect(z.coerce.date().safeParse(null).success).toBe(true);
});
