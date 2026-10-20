import { For, type JSX } from "solid-js";
import type * as core from "zod/v4/core";
import { describeFields, type FieldOverride } from "@/forms/describe-field";
import { formState } from "@/forms/form-state";
import Field from "./Field";
import FormAlert from "./FormAlert";
import type { FieldTheme } from "./theme";

type Props<S extends core.$ZodObject> = {
	schema: S;
	/// An Astro action (`actions.admin.createDiscipline`) or its URL.
	action: { toString(): string };
	/// `Astro.getActionResult(action)`.
	result?: Parameters<typeof formState>[1];
	/// Values to show back after a failed submit; see `submittedValues`.
	values?: Record<string, string>;
	submitLabel: string;
	fields?: { [K in keyof S["_zod"]["def"]["shape"]]?: FieldOverride };
	theme?: FieldTheme;
	class?: string;
	/// Prefix of the control ids. Default `form`.
	id?: string;
};

/**
 * A complete POST form with one `<Field>` per schema field, in shape order.
 *
 * Renders on the server with no JS. For a custom layout, use `formState` and
 * `<Field>` directly.
 */
export default function SchemaForm<S extends core.$ZodObject>(
	props: Props<S>,
): JSX.Element {
	const form = () =>
		formState(props.schema, props.result, {
			id: props.id,
			fields: props.fields,
			values: props.values,
		});
	const names = () =>
		describeFields(props.schema, props.fields).map((spec) => spec.name);
	return (
		<form
			method="post"
			action={String(props.action)}
			class={props.class ?? "flex flex-col gap-4"}
		>
			<FormAlert error={form().error} />
			<For each={names()}>
				{(name) => (
					<Field
						{...form().field(name as keyof S["_zod"]["def"]["shape"] & string)}
						theme={props.theme}
					/>
				)}
			</For>
			<div class="card-actions justify-end">
				<button type="submit" class="btn btn-primary">
					{props.submitLabel}
				</button>
			</div>
		</form>
	);
}
