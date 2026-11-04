/**
 * Positional validation of function arguments with Zod schemas.
 */

import type { ZodType } from "zod";
import { InvalidData } from "@/core/error";

export type SchemaItem = ZodType<unknown> | undefined;

/**
 * Validates `args` positionally against `schemas` and returns them, replaced
 * by the parsed values.
 *
 * An `undefined` schema leaves that position unchecked.
 *
 * @throws {@link InvalidData} When an argument fails its schema.
 */
export function validateArgs<T extends unknown[]>(
	schemas: SchemaItem[],
	args: T,
): T {
	for (let i = 0; i < schemas.length; i++) {
		const schema = schemas[i];
		const arg = args[i];
		if (schema) {
			const validationResult = schema.safeParse(arg);
			if (!validationResult.success)
				throw InvalidData.fromZodError(validationResult.error, arg);
			args[i] = validationResult.data;
		}
	}
	return args;
}
