import * as core from "zod/v4/core";
import type { FieldMeta } from "./meta";

/** Everything a form control needs to render and validate one schema field. */
export type FieldSpec = {
	name: string;
	kind:
		| "text"
		| "email"
		| "url"
		| "number"
		| "date"
		| "datetime"
		| "boolean"
		| "enum"
		| "textarea";
	required: boolean;
	label: string;
	hint?: string;
	placeholder?: string;
	/// The `form.widget` the schema or override asked for, when there is one.
	widget?: FieldMeta["widget"];
	attrs: {
		type?: string;
		minlength?: number;
		maxlength?: number;
		min?: number | string;
		max?: number | string;
		step?: number;
		pattern?: string;
	};
	options?: { value: string; label: string }[];
};

/// Per-form text overrides for a field. Same keys as the schema's `form` meta.
export type FieldOverride = FieldMeta;

type Bag = {
	minimum?: number | bigint | Date;
	maximum?: number | bigint | Date;
	format?: string;
};

/** Turns `firstName` or `first_name` into `First name`. */
export function humanize(name: string): string {
	const words = name
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[_-]+/g, " ")
		.trim()
		.toLowerCase();
	return words.charAt(0).toUpperCase() + words.slice(1);
}

/// Wrappers that describe the same field as their inner type.
function innerOf(schema: core.$ZodType): core.$ZodType | undefined {
	if (
		schema instanceof core.$ZodOptional ||
		schema instanceof core.$ZodNullable ||
		schema instanceof core.$ZodDefault
	) {
		return schema._zod.def.innerType as core.$ZodType;
	}
	if (schema instanceof core.$ZodPipe)
		return schema._zod.def.in as core.$ZodType;
	return undefined;
}

/// Unwraps `schema` to its base type, collecting the first `form`, `title` and
/// `description` found on the way (wrappers lose the meta of what they wrap).
function unwrap(schema: core.$ZodType) {
	let required = true;
	let meta: core.GlobalMeta = {};
	let base = schema;
	for (;;) {
		const found = core.globalRegistry.get(base);
		if (found) {
			meta = {
				form: meta.form ?? found.form,
				title: meta.title ?? found.title,
				description: meta.description ?? found.description,
			};
		}
		if (
			base instanceof core.$ZodOptional ||
			base instanceof core.$ZodNullable ||
			base instanceof core.$ZodDefault
		) {
			required = false;
		}
		const inner = innerOf(base);
		if (!inner) return { base, required, meta };
		base = inner;
	}
}

/// Converts a zod date bound to what `<input type="date|datetime-local">` takes.
function dateAttr(value: unknown, kind: "date" | "datetime") {
	if (!(value instanceof Date)) return undefined;
	const iso = value.toISOString();
	return kind === "date" ? iso.slice(0, 10) : iso.slice(0, 16);
}

/// The HTML `pattern` equivalent of `regex`, or undefined when there is none.
///
/// The attribute is anchored and compiled with the `v` flag, while zod matches
/// anywhere with the regex's own flags. Only a regex that is explicitly
/// anchored and flagless means the same thing in both.
function safePattern(regex: RegExp): string | undefined {
	if (regex.flags !== "") return undefined;
	const { source } = regex;
	if (
		!source.startsWith("^") ||
		!source.endsWith("$") ||
		source.endsWith("\\$")
	) {
		return undefined;
	}
	const body = source.slice(1, -1);
	try {
		new RegExp(`^(?:${body})$`, "v");
	} catch {
		return undefined;
	}
	return body;
}

/// Describes a string-like base type.
function describeString(
	base: core.$ZodString,
	widget: FieldMeta["widget"],
): Pick<FieldSpec, "kind" | "attrs"> {
	const bag = base._zod.bag as Bag;
	const attrs: FieldSpec["attrs"] = {};
	if (typeof bag.minimum === "number") attrs.minlength = bag.minimum;
	if (typeof bag.maximum === "number") attrs.maxlength = bag.maximum;
	const regexes = (base._zod.def.checks ?? []).filter(
		(check) =>
			check._zod.def.check === "string_format" &&
			(check._zod.def as { format?: string }).format === "regex",
	);
	const [only] = regexes.length === 1 ? regexes : [];
	if (only) {
		const regex = (only._zod.def as { pattern?: RegExp }).pattern;
		const pattern = regex && safePattern(regex);
		if (pattern) attrs.pattern = pattern;
	}
	const { format } = base._zod.def as { format?: string };
	if (format === "email") return { kind: "email", attrs };
	if (format === "url") return { kind: "url", attrs };
	if (format === "datetime") return { kind: "datetime", attrs: {} };
	if (format === "date") return { kind: "date", attrs: {} };
	if (widget === "textarea") return { kind: "textarea", attrs };
	if (widget === "password")
		return { kind: "text", attrs: { ...attrs, type: "password" } };
	return { kind: "text", attrs };
}

/// The attributes and kind derived from the type and checks of `base`.
function describeBase(
	name: string,
	base: core.$ZodType,
	widget: FieldMeta["widget"],
): Pick<FieldSpec, "kind" | "attrs" | "options"> {
	if (base instanceof core.$ZodString) return describeString(base, widget);
	if (base instanceof core.$ZodNumber) {
		const bag = base._zod.bag as Bag;
		const attrs: FieldSpec["attrs"] = {};
		if (
			typeof bag.minimum === "number" &&
			bag.minimum > -Number.MAX_SAFE_INTEGER
		) {
			attrs.min = bag.minimum;
		}
		if (
			typeof bag.maximum === "number" &&
			bag.maximum < Number.MAX_SAFE_INTEGER
		) {
			attrs.max = bag.maximum;
		}
		const multipleOf = (bag as { multipleOf?: number }).multipleOf;
		if (bag.format?.endsWith("int")) attrs.step = 1;
		else if (typeof multipleOf === "number") attrs.step = multipleOf;
		return { kind: "number", attrs };
	}
	if (base instanceof core.$ZodDate) {
		const bag = base._zod.bag as Bag;
		const attrs: FieldSpec["attrs"] = {};
		const min = dateAttr(bag.minimum, "date");
		const max = dateAttr(bag.maximum, "date");
		if (min) attrs.min = min;
		if (max) attrs.max = max;
		return { kind: "date", attrs };
	}
	if (base instanceof core.$ZodBoolean) return { kind: "boolean", attrs: {} };
	if (base instanceof core.$ZodEnum) {
		const values = Object.values(base._zod.def.entries).filter(
			(value): value is string => typeof value === "string",
		);
		return {
			kind: "enum",
			attrs: {},
			options: [...new Set(values)].map((value) => ({
				value,
				label: humanize(value),
			})),
		};
	}
	throw new Error(
		`Field "${name}": cannot derive a form control from zod type "${base._zod.def.type}". Write the field by hand.`,
	);
}

/**
 * Describes a schema field as the control that edits it.
 *
 * Label resolves from `override`, `form.label`, `title`, then the humanized
 * name; the hint from `override`, `form.hint`, then `description`.
 *
 * @throws If the schema (after unwrapping optional, nullable, default and pipe)
 * is not a string, number, date, boolean or enum.
 */
export function describeField(
	name: string,
	schema: core.$ZodType,
	override: FieldOverride = {},
): FieldSpec {
	const { base, required, meta } = unwrap(schema);
	const widget = override.widget ?? meta.form?.widget;
	const described = describeBase(name, base, widget);
	const hint = override.hint ?? meta.form?.hint ?? meta.description;
	const placeholder = override.placeholder ?? meta.form?.placeholder;
	return {
		name,
		required,
		label: override.label ?? meta.form?.label ?? meta.title ?? humanize(name),
		...(hint !== undefined && { hint }),
		...(placeholder !== undefined && { placeholder }),
		...(widget !== undefined && { widget }),
		...described,
	};
}

/**
 * Describes every field of an object schema, in shape order.
 *
 * @throws If a field has a type `describeField` does not support.
 */
export function describeFields<S extends core.$ZodObject>(
	schema: S,
	overrides: { [K in keyof S["_zod"]["def"]["shape"]]?: FieldOverride } = {},
): FieldSpec[] {
	const shape = schema._zod.def.shape as Record<string, core.$ZodType>;
	const byName = overrides as Record<string, FieldOverride | undefined>;
	return Object.entries(shape).map(([name, field]) =>
		describeField(name, field, byName[name]),
	);
}
