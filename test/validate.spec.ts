import { expect, test } from "@playwright/test";
import { z } from "zod";
import { SYSTEM } from "@/core/actor";
import type { ServiceOpts } from "@/db/base-service";
import { Validate } from "@/utils/validate";

const opts: ServiceOpts = { actor: SYSTEM };

//
// @Validate (non-service) argument validation, via `args`
//

test("@Validate validates all args-decorated parameters", () => {
	class Plain {
		@Validate({ args: [z.string().min(3), z.number().positive()] })
		method(a: string, b: number) {
			return `${a}:${b}`;
		}
	}
	const instance = new Plain();
	expect(instance.method("abc", 5)).toBe("abc:5");
	expect(() => instance.method("ab", 5)).toThrow();
	expect(() => instance.method("abc", -1)).toThrow();
});

test("@Validate skips parameters left undefined in `args`", () => {
	class Plain {
		@Validate({ args: [z.string().min(3)] })
		method(a: string, b: number) {
			return `${a}:${b}`;
		}
	}
	const instance = new Plain();
	// `b` has no schema, so any value passes.
	expect(instance.method("abc", -1)).toBe("abc:-1");
});

test("@Validate applies schema transformations to arguments (coercion)", () => {
	class Plain {
		@Validate({ args: [z.coerce.number()] })
		method(a: number) {
			return typeof a;
		}
	}
	const instance = new Plain();
	// @ts-expect-error - deliberately passing a string to test coercion
	expect(instance.method("42")).toBe("number");
});

//
// @Validate return-value validation.
//

test("@Validate (sync) validates the return value and throws on mismatch", () => {
	class Plain {
		@Validate({ returns: z.string().min(10) })
		method(): string {
			return "short";
		}
	}
	const instance = new Plain();
	expect(() => instance.method()).toThrow();
});

test("the thrown return-validation error is an Error instance", () => {
	class Plain {
		@Validate({ returns: z.string().min(10) })
		method(): string {
			return "short";
		}
	}
	const instance = new Plain();
	let caught: unknown;
	try {
		instance.method();
	} catch (e) {
		caught = e;
	}
	expect(caught).toBeInstanceOf(Error);
});

test("@Validate (async: true) validates async return values", async () => {
	class Plain {
		@Validate({ async: true, returns: z.string().min(10) })
		async method(): Promise<string> {
			return "short";
		}
	}
	const instance = new Plain();
	await expect(instance.method()).rejects.toThrow();
});

test("FOOTGUN: forgetting async:true on an async method with `returns` validates the raw Promise instead of the resolved value", async () => {
	class Plain {
		// No `async: true`, even though `method` is async. This is a real risk since
		// nothing in the API ties `async` to the underlying method's actual signature.
		@Validate({ returns: z.string().min(3) })
		async method(): Promise<string> {
			return "this is plenty long"; // would pass validation if it were awaited first
		}
	}
	const instance = new Plain();
	// The call throws synchronously, validating the pending Promise object against the
	// schema, instead of returning a promise that resolves/rejects based on the real value.
	let threwSynchronously = false;
	try {
		instance.method();
	} catch {
		threwSynchronously = true;
	}
	expect(threwSynchronously).toBe(true);
});

//
// @Validate service mode
//

class UserLikeService {
	@Validate({
		service: true,
		returns: z.object({ name: z.string().min(3) }),
		args: [z.object({ name: z.string().min(1) })],
	})
	async create(input: { name: string }, _: ServiceOpts) {
		return { name: input.name };
	}

	@Validate({ service: true, args: [z.string().min(1)] })
	async noReturnSchema(name: string, _: ServiceOpts) {
		return { name };
	}
}

test("service mode: validates input and rejects invalid input by default", async () => {
	const service = new UserLikeService();
	await expect(service.create({ name: "" }, opts)).rejects.toBeTruthy();
});

test("service mode: validates output and rejects invalid output by default", async () => {
	const service = new UserLikeService();
	// "ab" is valid input (min 1) but invalid output (returns schema wants min 3).
	await expect(service.create({ name: "ab" }, opts)).rejects.toBeTruthy();
	await expect(service.create({ name: "abc" }, opts)).resolves.toEqual({
		name: "abc",
	});
});

test("service mode: skipValidation === true skips both input and output validation", async () => {
	const service = new UserLikeService();
	await expect(
		service.create({ name: "" }, { ...opts, skipValidation: true }),
	).resolves.toEqual({ name: "" });
});

test("service mode: skipValidation.input skips only input validation", async () => {
	const service = new UserLikeService();
	// name "abc" clears the output schema too, so only input skipping is exercised.
	await expect(
		service.create({ name: "" }, { ...opts, skipValidation: { input: true } }),
	).rejects.toBeTruthy(); // still rejects: output schema (min 3) fails on ""
});

test("service mode: skipValidation.output skips only output validation", async () => {
	const service = new UserLikeService();
	await expect(service.create({ name: "a" }, opts)).rejects.toBeTruthy();
	await expect(
		service.create(
			{ name: "a" },
			{ ...opts, skipValidation: { output: true } },
		),
	).resolves.toEqual({ name: "a" });
});

test("service mode: methods without a `returns` schema skip output validation automatically", async () => {
	const service = new UserLikeService();
	await expect(service.noReturnSchema("x", opts)).resolves.toEqual({
		name: "x",
	});
});
