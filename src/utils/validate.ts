/**
 * Decorators for validating input parameters of general functions.
 */

import { type ZodType, z } from "zod";
import type { ServiceOpts } from "@/db/base-service";

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
};

// biome-ignore-start lint/suspicious/noExplicitAny: Generic types for functions
type ClassDef = any;
type This = any;
// biome-ignore-end lint/suspicious/noExplicitAny: End

type SchemaItem = ZodType<unknown> | undefined;

/**
 * Decorator for validating a function parameter using a Zod schema.
 * 
 * This is used decorating a method parameter. It now verifies the parameter 
 * against a zod schema
 * 
 * ```typescript
 * class MyClass {
 *   method(@Arg(z.string().min(10)) param: string) {
 *     // method implementation
 *   }
 * 
 * const instance = new MyClass();
 * instance.method("short"); // throws error: Argument validation failed: ...
 * instance.method("long enough string"); // works fine
 * ```
 *
 * @param schema - The Zod schema to validate the parameter against. Users must
 * manually ensure the argument type is compatible with the schema, as
 * Typescript cannot inspect that.
 */
export function Arg<T>(schema: ZodType<T>) {
    return (target: ClassDef, propertyKey: string, parameterIndex: number) => {
        const original = target[propertyKey];
        const wrapped = function (this: This, ...args: unknown[]) {
            if (mustWarnToUseValidate) {
                console.warn(
                    `Warning: More than one @Arg decorator found in this method. ` +
                    `This can be inefficient if you don't use @Validate in the method.`,
                );
                mustWarnToUseValidate = false;
            }

            const validationResult = schema.safeParse(args[parameterIndex]);
            if (!validationResult.success) {
                throw new Error(
                    `Argument validation failed: ${validationResult.error}`,
                );
            }

            return original.apply(this, args);
        };
        target[propertyKey] = wrapped;

        // Store the schema for later use in @Validate
        wrapped.__argSchemas = original.__argSchemas ?? {};
        wrapped.__argSchemas[parameterIndex] = schema;

        // Store the original method for later use in @Validate
        wrapped.__originalMethod = original.__originalMethod ?? original;

        // Store the nesting level, so we can warn the user to call @Validate
        wrapped.__nestingLevel = (original.__nestingLevel ?? 0) + 1;
        const tooMuchNesting = wrapped.__nestingLevel > 1;
        let mustWarnToUseValidate = tooMuchNesting;
    };
}

/**
 * Decorator for validating the return value of a function using a Zod schema.
 * 
 * This is used decorating a method. It now verifies the return value against a zod schema
 * 
 * ```typescript
 * class MyClass {
 *   @Validate({ returns: z.string().min(10) })
 *   method(): string {
 *     return "short"; // throws error: Return value validation failed: ...
 *   }
 * }
 * ```
 *
 * @param options - The validation options, including the Zod schema for the 
 * return value. See {@link ValidateOptions}.
 */
export function Validate(options: ValidateOptions) {
    return (
        _target: ClassDef,
        _propertyKey: string,
        descriptor: PropertyDescriptor,
    ) => {
        const originalMethod = descriptor.value.__originalMethod ?? descriptor.value;
        const argSchemas = (descriptor.value.__argSchemas ?? []) as SchemaItem[];
        const hasArgSchemas = argSchemas.some((schema) => schema !== undefined);

        function runFunction(self: This, args: unknown[]) {
            const result = originalMethod.apply(self, args);
            if (options.returns) {
                const validationResult = options.returns.safeParse(result);
                if (!validationResult.success) {
                    // TODO: which validation error we use?
                    // Probably we should define that in the error module.
                    throw z.treeifyError(validationResult.error);
                }
            }
            return result;
        }

        async function runFunctionAsync(self: This, args: unknown[]) {
            const result = await originalMethod.apply(self, args);
            if (options.returns) {
                const validationResult = options.returns.safeParse(result);
                if (!validationResult.success) {
                    // TODO: which validation error we use?
                    // Probably we should define that in the error module.
                    throw z.treeifyError(validationResult.error);
                }
            }
            return result;
        }

        // If service = true, we change the validation behavior
        if (options.service) {
            descriptor.value = async function <T extends unknown[]>(this: This, ...args: T) {
                const opts = args[args.length - 1] as ServiceOpts;
                const skipInputValidation = typeof opts.skipValidation === "object"
                    ? opts.skipValidation.input
                    : opts.skipValidation;
                const skipOutputValidation = options.returns === undefined
                    || (typeof opts.skipValidation === "object"
                        ? opts.skipValidation.output
                        : opts.skipValidation);

                if (hasArgSchemas && !skipInputValidation) args = validateArgs(argSchemas, args);
                return skipOutputValidation ? await originalMethod.apply(this, args) : await runFunctionAsync(this, args);
            };
        } else if (options.async) {
            descriptor.value = async function <T extends unknown[]>(this: This, ...args: T) {
                if (hasArgSchemas) args = validateArgs(argSchemas, args);
                return await runFunctionAsync(this, args);
            };
        } else {
            descriptor.value = function <T extends unknown[]>(this: This, ...args: T) {
                if (hasArgSchemas) args = validateArgs(argSchemas, args);
                return runFunction(this, args);
            };
        }

        return descriptor;
    };
}

function validateArgs<T extends unknown[]>(schemas: SchemaItem[], args: T): T {
    for (let i = 0; i < schemas.length; i++) {
        const schema = schemas[i];
        const arg = args[i];
        if (schema) {
            const validationResult = schema.safeParse(arg);
            if (!validationResult.success) {
                // TODO: which validation error we use?
                // Probably we should define that in the error module.
                throw z.treeifyError(validationResult.error);
            }
            args[i] = validationResult.data;
        }
    }
    return args;
}
