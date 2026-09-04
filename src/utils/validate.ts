/**
 * Decorators for validating input parameters of general functions.
 */

import type { ZodType } from "zod";
import { InvalidData } from "@/core/error";
import type { ServiceOpts } from "@/db/base-service";

type SchemaItem = ZodType<unknown> | undefined;

/**
 * Options for the {@link @Validate} decorator.
 */
export type ValidateOptions = {
	/** True for methods of a service class.
	 *
	 * It assumes that the last parameter is a ServiceOpts object and method is async.
	 * ServiceOpts.skipValidation is used to conditionally skip input and/or output validation.
	 */
	service?: boolean;

	/** The Zod schema to validate the return value against. */
	returns?: ZodType<unknown>;

	/* If true, the method is async and returns a Promise. */
	async?: boolean;

	/**
	 * Zod schemas for the method's parameters, positional (index 0 validates the
	 * first parameter, and so on). Leave an index `undefined` to skip validating
	 * that parameter, e.g. bare primitives or the trailing `ServiceOpts`.
	 */
	args?: SchemaItem[];
};

// biome-ignore-start lint/suspicious/noExplicitAny: Generic types for functions
type This = any;
// biome-ignore-end lint/suspicious/noExplicitAny: End

/**
 * Decorator for validating the return value (and, via {@link ValidateOptions.args},
 * the parameters) of a method using Zod schemas.
 *
 * ```typescript
 * class MyClass {
 *   @Validate({ args: [z.string().min(10)], returns: z.string().min(10) })
 *   method(param: string): string {
 *     return "short"; // throws error: Return value validation failed: ...
 *   }
 * }
 * ```
 *
 * Implemented to work as both a legacy (`experimentalDecorators`) and a TC39
 * Stage-3 method decorator: Playwright Test's bundled Babel transform only
 * supports Stage-3 (see `dev/issues/arg-decorator-breaks-playwright-test-transform.md`),
 * while the rest of the toolchain (Astro/Vite, `tsx`) uses the legacy form, so the
 * two calling conventions — `(target, propertyKey, descriptor)` vs. `(value, context)`
 * — need to both work from a single decorated method. `arguments.length` (3 vs. 2)
 * tells them apart.
 *
 * @param options - The validation options. See {@link ValidateOptions}.
 */
export function Validate(options: ValidateOptions) {
	const argSchemas = options.args ?? [];
	const hasArgSchemas = argSchemas.some((schema) => schema !== undefined);

	function wrap(originalMethod: (...args: unknown[]) => unknown) {
		function runFunction(self: This, args: unknown[]) {
			const result = originalMethod.apply(self, args);
			if (options.returns) {
				const validationResult = options.returns.safeParse(result);
				if (!validationResult.success) {
					throw InvalidData.fromZodError(validationResult.error, result);
				}
			}
			return result;
		}

		async function runFunctionAsync(self: This, args: unknown[]) {
			const result = await originalMethod.apply(self, args);
			if (options.returns) {
				const validationResult = options.returns.safeParse(result);
				if (!validationResult.success) {
					throw InvalidData.fromZodError(validationResult.error, result);
				}
			}
			return result;
		}

		// If service = true, we change the validation behavior
		if (options.service) {
			return async function <T extends unknown[]>(this: This, ...args: T) {
				const opts = args[args.length - 1] as ServiceOpts;
				const skipInputValidation =
					typeof opts.skipValidation === "object"
						? opts.skipValidation.input
						: opts.skipValidation;
				const skipOutputValidation =
					options.returns === undefined ||
					(typeof opts.skipValidation === "object"
						? opts.skipValidation.output
						: opts.skipValidation);

				if (hasArgSchemas && !skipInputValidation)
					args = validateArgs(argSchemas, args);
				return skipOutputValidation
					? await originalMethod.apply(this, args)
					: await runFunctionAsync(this, args);
			};
		}
		if (options.async) {
			return async function <T extends unknown[]>(this: This, ...args: T) {
				if (hasArgSchemas) args = validateArgs(argSchemas, args);
				return await runFunctionAsync(this, args);
			};
		}
		return function <T extends unknown[]>(this: This, ...args: T) {
			if (hasArgSchemas) args = validateArgs(argSchemas, args);
			return runFunction(this, args);
		};
	}

	// Typed loosely on purpose: this same function must satisfy both the legacy
	// decorator call signature TS checks for under `experimentalDecorators` and the
	// Stage-3 one Playwright's transform actually invokes at runtime — see above.
	// biome-ignore lint/suspicious/noExplicitAny: hybrid decorator signature
	return (...decoratorArgs: unknown[]): any => {
		if (decoratorArgs.length === 3) {
			// Legacy decorator: (target, propertyKey, descriptor)
			const descriptor = decoratorArgs[2] as PropertyDescriptor;
			descriptor.value = wrap(descriptor.value);
			return descriptor;
		}
		// Stage-3 decorator: (value, context)
		return wrap(decoratorArgs[0] as (...args: unknown[]) => unknown);
	};
}

function validateArgs<T extends unknown[]>(schemas: SchemaItem[], args: T): T {
	for (let i = 0; i < schemas.length; i++) {
		const schema = schemas[i];
		const arg = args[i];
		if (schema) {
			const validationResult = schema.safeParse(arg);
			if (!validationResult.success) throw InvalidData.fromZodError(validationResult.error, arg);
			args[i] = validationResult.data;
		}
	}
	return args;
}
