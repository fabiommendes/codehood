import { expect, test } from "@playwright/test";
import { FieldError, NotFound, RuleViolation } from "@/core/error";
import { responseFromException } from "@/core/error-server";
import { m } from "@/i18n";

/// An exception whose message leaks database details.
const leaky = () => new Error('no such column: "User"."password"');

test.describe("responseFromException in production", () => {
	/// What `console.error` received during the test.
	let logged: unknown[] = [];
	const original = console.error;
	test.beforeEach(() => {
		logged = [];
		console.error = (...args: unknown[]) => logged.push(...args);
	});
	test.afterEach(() => {
		console.error = original;
	});

	test("a generic exception becomes a 500 without its message, and is logged", () => {
		const error = leaky();
		const response = responseFromException(error, true);
		expect(response).toMatchObject({
			code: "internal-error",
			status: 500,
			message: m.errors_internal(),
		});
		expect(logged).toEqual([error]);
	});

	test("a rule violation becomes a 500 without its message", () => {
		const error = new RuleViolation({ message: "exam 42 has no owner" });
		const response = responseFromException(error, true);
		expect(response).toMatchObject({ code: "internal-error", status: 500 });
		expect(response.message).not.toContain("42");
	});

	test("a thrown non-Error becomes a 500 without its text", () => {
		const response = responseFromException({ status: 400, code: "x" }, true);
		expect(response).toMatchObject({ code: "internal-error", status: 500 });
	});

	test("a field error becomes a 400 on its field, and is not logged", () => {
		const response = responseFromException(
			new FieldError("slug", "The slug is taken"),
			true,
		);
		expect(response).toMatchObject({
			code: "invalid-data",
			status: 400,
			message: "slug: The slug is taken",
			errors: { slug: [{ code: "invalid", message: "The slug is taken" }] },
		});
		expect(logged).toEqual([]);
	});

	test("a user-facing error keeps its status and message", () => {
		const error = new NotFound("course", { message: "No such course" });
		const response = responseFromException(error, true);
		expect(response).toMatchObject({ status: 404, message: "No such course" });
	});
});

test("outside production a field error is also a 400", () => {
	const response = responseFromException(
		new FieldError("slug", "Taken"),
		false,
	);
	expect(response).toMatchObject({ code: "invalid-data", status: 400 });
});

test("outside production a generic exception keeps its message", () => {
	const response = responseFromException(leaky(), false);
	expect(response.message).toBe(leaky().message);
});
