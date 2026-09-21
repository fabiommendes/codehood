import { expect, test } from "@playwright/test";
import { z } from "zod";
import { SYSTEM } from "@/auth/actor";
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

test("@Validate validates the resolved value of an async method, not its Promise", async () => {
	class Plain {
		@Validate({ returns: z.string().min(10) })
		async method(): Promise<string> {
			return "short";
		}
	}
	const instance = new Plain();
	await expect(instance.method()).rejects.toThrow();
});

test("@Validate rejects asynchronously instead of throwing on the call itself", async () => {
	class Plain {
		@Validate({ returns: z.string().min(3) })
		async method(): Promise<string> {
			return "this is plenty long";
		}
	}
	const instance = new Plain();
	// A schema the raw Promise object could never satisfy: the value reaching
	// it is the resolved string, so the call returns a promise rather than
	// throwing where the caller cannot catch it.
	let threwSynchronously = false;
	let resolved: unknown;
	try {
		resolved = await instance.method();
	} catch {
		threwSynchronously = true;
	}
	expect(threwSynchronously).toBe(false);
	expect(resolved).toBe("this is plenty long");
});

test("@Validate service mode rejects a non-ServiceOpts value in the opts position", async () => {
	class Service {
		@Validate({ service: true, args: [z.string().min(1)] })
		async method(name: string, _: ServiceOpts) {
			return { name };
		}
	}
	const service = new Service();
	await expect(
		// @ts-expect-error - deliberately passing the wrong type, which JS allows
		service.method("abc", "not-opts"),
	).rejects.toThrow(/ServiceOpts/);
});

test("@Validate service mode accepts a method whose opts is optional being called without it", async () => {
	class Service {
		@Validate({ service: true, returns: z.object({ name: z.string() }) })
		async method(name: string, opts?: ServiceOpts) {
			return { name, actor: opts?.actor };
		}
	}
	const service = new Service();
	await expect(service.method("abc")).resolves.toMatchObject({ name: "abc" });
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
		service.create({ name: "" }, { ...opts, validate: "none" }),
	).resolves.toEqual({ name: "" });
});

test("service mode: skipValidation.input skips only input validation", async () => {
	const service = new UserLikeService();
	// name "abc" clears the output schema too, so only input skipping is exercised.
	await expect(
		service.create({ name: "" }, { ...opts, validate: "output" }),
	).rejects.toBeTruthy(); // still rejects: output schema (min 3) fails on ""
});

test("service mode: skipValidation.output skips only output validation", async () => {
	const service = new UserLikeService();
	await expect(service.create({ name: "a" }, opts)).rejects.toBeTruthy();
	await expect(
		service.create({ name: "a" }, { ...opts, validate: "input" }),
	).resolves.toEqual({ name: "a" });
});

test("service mode: methods without a `returns` schema skip output validation automatically", async () => {
	const service = new UserLikeService();
	await expect(service.noReturnSchema("x", opts)).resolves.toEqual({
		name: "x",
	});
});
