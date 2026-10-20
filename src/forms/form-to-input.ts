import * as core from "zod/v4/core";

/**
 * Converts `formData` into the object an Astro form action would parse.
 *
 * Mirrors Astro's internal `formDataToObject` rule for rule, so a form that
 * validates on the client with this input validates the same on the server.
 * `test/forms-form-to-input.spec.ts` compares the two. Anything but an object
 * schema (after unwrapping pipes and discriminated unions) returns `formData`.
 *
 * Empty fields become `undefined` when optional and `null` otherwise. That
 * `null` is what Astro hands to the schema, and `z.coerce.date()` turns it into
 * 1970-01-01 without raising an issue, so a required coerced date cannot be
 * rejected here or in an error map: use a non-coercing date schema for it.
 */
export function formToInput(
	schema: core.$ZodType,
	formData: FormData,
): unknown {
	const base = unwrapBaseObjectSchema(schema, formData);
	return base instanceof core.$ZodObject
		? formDataToObject(formData, base)
		: formData;
}

type Shape = Record<string, core.$ZodType>;

function unwrapBaseObjectSchema(
	schema: core.$ZodType,
	formData: FormData,
): core.$ZodType {
	if (schema instanceof core.$ZodPipe) {
		return unwrapBaseObjectSchema(
			schema._zod.def.in as core.$ZodType,
			formData,
		);
	}
	if (schema instanceof core.$ZodDiscriminatedUnion) {
		const typeKey = schema._zod.def.discriminator;
		const typeValue = formData.get(typeKey);
		if (typeof typeValue !== "string") return schema;
		return matchOption(schema, typeKey, typeValue) ?? schema;
	}
	return schema;
}

function matchOption(
	schema: core.$ZodDiscriminatedUnion,
	typeKey: string,
	typeValue: string,
): core.$ZodObject | undefined {
	return (schema._zod.def.options as core.$ZodObject[]).find((option) =>
		(
			(option._zod.def.shape as Record<string, core.$ZodType>)[typeKey]?._zod
				.values as Set<unknown> | undefined
		)?.has(typeValue),
	);
}

function hasKeyOrPrefix(formKeys: string[], key: string): boolean {
	const prefix = `${key}.`;
	return formKeys.some((k) => k === key || k.startsWith(prefix));
}

function formDataToObject(
	formData: FormData,
	schema: core.$ZodObject,
	prefix = "",
): Record<string, unknown> {
	const formKeys = [...formData.keys()];
	const obj: Record<string, unknown> = schema._zod.def.catchall
		? Object.fromEntries(
				[...formData.entries()]
					.filter(([k]) => k.startsWith(prefix))
					.map(([k, v]) => [k.slice(prefix.length), v]),
			)
		: {};
	for (const [key, baseValidator] of Object.entries(
		schema._zod.def.shape as Shape,
	)) {
		const prefixedKey = prefix + key;
		let validator: core.$ZodType = baseValidator;
		while (
			validator instanceof core.$ZodOptional ||
			validator instanceof core.$ZodNullable ||
			validator instanceof core.$ZodDefault
		) {
			if (
				validator instanceof core.$ZodDefault &&
				!hasKeyOrPrefix(formKeys, prefixedKey)
			) {
				const { defaultValue } = validator._zod.def;
				obj[key] =
					defaultValue instanceof Function ? defaultValue() : defaultValue;
			}
			validator = validator._zod.def.innerType as core.$ZodType;
		}
		while (validator instanceof core.$ZodPipe) {
			validator = validator._zod.def.in as core.$ZodType;
		}
		if (validator instanceof core.$ZodDiscriminatedUnion) {
			const typeKey = validator._zod.def.discriminator;
			const typeValue = formData.get(`${prefixedKey}.${typeKey}`);
			if (typeof typeValue === "string") {
				validator = matchOption(validator, typeKey, typeValue) ?? validator;
			}
		}
		if (validator instanceof core.$ZodObject) {
			const nestedPrefix = `${prefixedKey}.`;
			if (formKeys.some((k) => k.startsWith(nestedPrefix))) {
				obj[key] = formDataToObject(formData, validator, nestedPrefix);
			} else if (!(key in obj)) {
				obj[key] =
					baseValidator instanceof core.$ZodNullable ? null : undefined;
			}
		} else if (!formData.has(prefixedKey) && key in obj) {
		} else if (validator instanceof core.$ZodBoolean) {
			const val = formData.get(prefixedKey);
			obj[key] =
				val === "true"
					? true
					: val === "false"
						? false
						: formData.has(prefixedKey);
		} else if (validator instanceof core.$ZodArray) {
			obj[key] = getAll(prefixedKey, formData, validator);
		} else {
			obj[key] = getOne(prefixedKey, formData, validator, baseValidator);
		}
	}
	return obj;
}

function getAll(
	key: string,
	formData: FormData,
	validator: core.$ZodArray,
): unknown[] {
	const entries = formData.getAll(key);
	const element = validator._zod.def.element;
	if (element instanceof core.$ZodNumber) return entries.map(Number);
	if (element instanceof core.$ZodBoolean) {
		return entries.map((v) =>
			v === "true" ? true : v === "false" ? false : Boolean(v),
		);
	}
	return entries;
}

function getOne(
	key: string,
	formData: FormData,
	validator: core.$ZodType,
	baseValidator: core.$ZodType,
): unknown {
	const value = formData.get(key);
	if (!value)
		return baseValidator instanceof core.$ZodOptional ? undefined : null;
	return validator instanceof core.$ZodNumber ? Number(value) : value;
}
