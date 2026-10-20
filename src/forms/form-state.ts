import type { ActionError } from "astro:actions";
import type * as core from "zod/v4/core";
import {
	describeField,
	type FieldOverride,
	type FieldSpec,
} from "./describe-field";
import { installErrorMap } from "./error-map";
import { fieldErrors } from "./field-errors";

installErrorMap();

/// What `<Field>` renders: the spec plus the current value and errors.
export type FieldView = FieldSpec & {
	/// DOM id of the control; derived from the form id and the field name.
	id: string;
	/// The value to show, as the browser submitted it.
	value: string;
	errors: string[];
};

/// The shape of `Astro.getActionResult(...)` that `formState` reads.
type ActionResult = { data?: unknown; error?: ActionError } | undefined;

/** The per-field views and the general error of one form on an Astro page. */
export type FormState<S extends core.$ZodObject> = {
	/** Everything `<Field>` needs for the schema field `name`. */
	field(name: keyof S["_zod"]["def"]["shape"] & string): FieldView;
	/** The error that belongs to no field (forbidden, not found...), if any. */
	error: string | undefined;
};

type FormStateOptions<S extends core.$ZodObject> = {
	/// Prefix of the control ids. Give each form on a page its own. Default `form`.
	id?: string;
	/// Per-form label, hint and placeholder overrides, keyed like the schema.
	fields?: { [K in keyof S["_zod"]["def"]["shape"]]?: FieldOverride };
	/// Values to show back after a failed submit; see {@link submittedValues}.
	values?: Record<string, string>;
};

/**
 * Reads the string fields of a POSTed form from `request` without consuming it.
 *
 * Astro runs the action on a clone, so the page can still read the body.
 * Returns `{}` for a request that carries no form (a plain GET, a JSON call).
 *
 * @example
 * const form = formState(schema, result, { values: await submittedValues(Astro.request) });
 */
export async function submittedValues(
	request: Request,
): Promise<Record<string, string>> {
	if (request.method !== "POST") return {};
	const type = request.headers.get("content-type") ?? "";
	if (!/multipart\/form-data|application\/x-www-form-urlencoded/.test(type)) {
		return {};
	}
	try {
		const data = await request.clone().formData();
		const values: Record<string, string> = {};
		for (const [key, value] of data) {
			if (typeof value === "string") values[key] = value;
		}
		return values;
	} catch {
		return {};
	}
}

/**
 * Derives the state of a form from the schema and the action result.
 *
 * Pure and server-side: each `field(name)` carries the spec, the submitted
 * value (only after a failed submit, never for a password) and that field's
 * errors.
 *
 * @example
 * const form = formState(disciplineCreate, Astro.getActionResult(actions.admin.createDiscipline));
 */
export function formState<S extends core.$ZodObject>(
	schema: S,
	result: ActionResult,
	options: FormStateOptions<S> = {},
): FormState<S> {
	const shape = schema._zod.def.shape as Record<string, core.$ZodType>;
	const overrides = (options.fields ?? {}) as Record<
		string,
		FieldOverride | undefined
	>;
	const errors = result?.error ? fieldErrors(result.error) : undefined;
	const prefix = options.id ?? "form";
	return {
		error: errors?.message,
		field(name) {
			const fieldSchema = shape[name];
			if (!fieldSchema) throw new Error(`Schema has no field "${name}".`);
			const spec = describeField(name, fieldSchema, overrides[name]);
			const keep = errors && spec.attrs.type !== "password";
			return {
				...spec,
				id: `${prefix}-${name}`,
				value: (keep && options.values?.[name]) || "",
				errors: errors?.fields[name] ?? [],
			};
		},
	};
}
