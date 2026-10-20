import type { ActionError } from "astro:actions";
import { batch, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import * as core from "zod/v4/core";
import {
	describeField,
	type FieldOverride,
	type FieldSpec,
} from "@/forms/describe-field";
import { installErrorMap } from "@/forms/error-map";
import { fieldErrors } from "@/forms/field-errors";
import type { FieldView } from "@/forms/form-state";
import { formToInput } from "@/forms/form-to-input";

installErrorMap();

/// What `<Field>` takes from a client form: the view plus the input handler.
export type ClientFieldView = FieldView & {
	onInput: (event: InputEvent) => void;
};

/// An Astro action called from the browser, as `createSchemaForm` uses it.
type ClientAction = (
	input: never,
) => PromiseLike<{ data?: unknown; error?: ActionError }>;

/** The options of {@link createSchemaForm}. */
export type SchemaFormOptions<S extends core.$ZodObject> = {
	/// The Astro action to call with the validated input.
	action: ClientAction;
	/// `"json"` sends the input object; `"form"` sends `FormData`, for actions declared `accept: "form"`. Default `"json"`.
	accept?: "json" | "form";
	/// Per-form label, hint and placeholder overrides, keyed like the schema.
	fields?: { [K in keyof S["_zod"]["def"]["shape"]]?: FieldOverride };
	/// Values for schema fields that have no control in the form. They win over form controls of the same name.
	hidden?: { [K in keyof S["_zod"]["def"]["shape"]]?: string };
	/// Prefix of the control ids. Default `form`.
	id?: string;
	/// Called with the action's data once it succeeds.
	onSuccess?: (data: unknown) => void;
};

/** The reactive state and handlers of one form on an island. */
export type SchemaForm<S extends core.$ZodObject> = {
	/** Everything `<Field>` needs for the schema field `name`, reactive. */
	field(name: keyof S["_zod"]["def"]["shape"] & string): ClientFieldView;
	/** The error that belongs to no field (forbidden, not found...), if any. */
	error(): string | undefined;
	/** Whether a submit is in flight, or has succeeded and the page is moving on. */
	busy(): boolean;
	/** The `onSubmit` handler of the `<form>`. */
	submit(event: SubmitEvent): Promise<void>;
};

/// The string entries of `data`, by name.
function stringEntries(data: FormData): Record<string, string> {
	const values: Record<string, string> = {};
	for (const [key, value] of data) {
		if (typeof value === "string") values[key] = value;
	}
	return values;
}

/// Groups zod issues by the first segment of their path.
function issuesByField(issues: core.$ZodIssue[]): Record<string, string[]> {
	const grouped: Record<string, string[]> = {};
	for (const issue of issues) {
		const name = String(issue.path[0] ?? "");
		grouped[name] = [...(grouped[name] ?? []), issue.message];
	}
	return grouped;
}

/// The control named `name` in `form`, or undefined when it has none.
function controlOf(
	form: HTMLFormElement,
	name: string,
): HTMLElement | undefined {
	const found = form.elements.namedItem(name);
	const first = found instanceof RadioNodeList ? found[0] : found;
	return first instanceof HTMLElement ? first : undefined;
}

/**
 * Creates the state of a form on a Solid island, derived from `schema`.
 *
 * Submit reads the `FormData`, merges `hidden`, validates it the way the
 * server will and calls `action`. Errors show per field, the first invalid
 * control takes focus, and a field that has an error is revalidated as the
 * user types. Errors that belong to no control surface in `error()`.
 *
 * @example
 * const form = createSchemaForm(gradeInput, {
 * 	action: actions.grading.grade,
 * 	hidden: { submission: props.submission },
 * 	onSuccess: () => window.location.reload(),
 * });
 * <form onSubmit={form.submit} noValidate>
 * 	<FormAlert error={form.error()} />
 * 	<Field {...form.field("score")} />
 * </form>
 */
export function createSchemaForm<S extends core.$ZodObject>(
	schema: S,
	options: SchemaFormOptions<S>,
): SchemaForm<S> {
	const shape = schema._zod.def.shape as Record<string, core.$ZodType>;
	const overrides = (options.fields ?? {}) as Record<
		string,
		FieldOverride | undefined
	>;
	const hidden = (options.hidden ?? {}) as Record<string, string>;
	const prefix = options.id ?? "form";
	const [state, setState] = createStore({
		values: {} as Record<string, string>,
		errors: {} as Record<string, string[]>,
	});
	const [error, setError] = createSignal<string | undefined>();
	const [busy, setBusy] = createSignal(false);

	/// The form's data with `hidden` merged in.
	function collect(form: HTMLFormElement): FormData {
		const data = new FormData(form);
		for (const [name, value] of Object.entries(hidden)) data.set(name, value);
		return data;
	}

	/// Validates `data` as the server would; returns the issues by field.
	function validate(data: FormData): Record<string, string[]> {
		const parsed = core.safeParse(schema, formToInput(schema, data));
		return parsed.success ? {} : issuesByField(parsed.error.issues);
	}

	/// Shows `errors`, sending those without a control to `error()` and focusing the first invalid control.
	function show(form: HTMLFormElement, errors: Record<string, string[]>): void {
		const orphans: string[] = [];
		const shown: Record<string, string[]> = {};
		for (const [name, messages] of Object.entries(errors)) {
			if (controlOf(form, name)) shown[name] = messages;
			else orphans.push(...messages);
		}
		batch(() => {
			setState("errors", shown);
			setError(orphans.length > 0 ? orphans.join(" ") : undefined);
		});
		const first = Object.keys(shape).find((name) => shown[name]);
		if (first) controlOf(form, first)?.focus();
	}

	function onInput(event: InputEvent): void {
		const target = event.target as HTMLInputElement | null;
		const form = target?.form;
		if (!target || !form) return;
		const data = collect(form);
		const failing = Object.keys(state.errors);
		batch(() => {
			setState("values", stringEntries(data));
			if (failing.length === 0) return;
			const issues = validate(data);
			for (const name of failing) setState("errors", name, issues[name] ?? []);
		});
	}

	async function submit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const form = event.currentTarget as HTMLFormElement;
		const data = collect(form);
		setState("values", stringEntries(data));
		const issues = validate(data);
		if (Object.keys(issues).length > 0) {
			show(form, issues);
			return;
		}
		setBusy(true);
		show(form, {});
		const payload =
			options.accept === "form" ? data : formToInput(schema, data);
		const { data: result, error: failure } = await options.action(
			payload as never,
		);
		if (failure) {
			const { fields, message } = fieldErrors(failure);
			show(form, fields);
			if (message) setError(message);
			setBusy(false);
			return;
		}
		options.onSuccess?.(result);
	}

	function field(name: string): ClientFieldView {
		const fieldSchema = shape[name];
		if (!fieldSchema) throw new Error(`Schema has no field "${name}".`);
		const spec: FieldSpec = describeField(name, fieldSchema, overrides[name]);
		return {
			...spec,
			id: `${prefix}-${name}`,
			onInput,
			get value() {
				return spec.attrs.type === "password" ? "" : (state.values[name] ?? "");
			},
			get errors() {
				return state.errors[name] ?? [];
			},
		};
	}

	return { field, error, busy, submit };
}
