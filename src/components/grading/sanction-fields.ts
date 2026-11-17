import { mergeProps } from "solid-js";
import { createStore } from "solid-js/store";
import type * as core from "zod/v4/core";
import type {
	ClientFieldView,
	SchemaForm,
} from "@/components/form/create-schema-form";

/**
 * Wraps `form.field` so each field starts with the value in `initial`, an empty text when it has none.
 *
 * Typing replaces the value, an emptied field stays empty, and the form's own
 * revalidation still runs on every input.
 */
export function withInitialValues<S extends core.$ZodObject>(
	form: SchemaForm<S>,
	initial: Readonly<Record<string, string>>,
): (name: keyof S["_zod"]["def"]["shape"] & string) => ClientFieldView {
	const [values, setValues] = createStore<Record<string, string>>({
		...initial,
	});
	return (name) => {
		const view = form.field(name);
		return mergeProps(view, {
			get value() {
				return values[name] ?? "";
			},
			onInput(event: InputEvent) {
				setValues(name, (event.target as HTMLInputElement).value);
				view.onInput(event);
			},
		});
	};
}
