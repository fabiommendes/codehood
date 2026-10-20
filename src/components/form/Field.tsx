import { type JSX, splitProps } from "solid-js";
import { Dynamic } from "solid-js/web";
import type { FieldSpec } from "@/forms/describe-field";
import type { FieldView } from "@/forms/form-state";
import { type ControlKind, defaultTheme, type FieldTheme } from "./theme";

export type FieldProps = FieldSpec &
	Partial<Pick<FieldView, "id" | "value" | "errors">> & {
		class?: string;
		/// Replaces the default control of some kinds, for this field only.
		theme?: FieldTheme;
	};

/// The theme key for `spec`: a `radio` or `toggle` widget wins over the kind.
function controlKind(spec: FieldSpec): ControlKind {
	if (spec.widget === "radio" && spec.kind === "enum") return "radio";
	if (spec.widget === "toggle" && spec.kind === "boolean") return "toggle";
	return spec.kind;
}

/**
 * One form control with label, hint and error, from the props that
 * `formState(...).field(name)` returns.
 */
export default function Field(props: FieldProps): JSX.Element {
	const [own, spec] = splitProps(props, [
		"class",
		"theme",
		"id",
		"value",
		"errors",
	]);
	const view = (): FieldView & { class?: string } => ({
		...(spec as FieldSpec),
		id: own.id ?? `field-${spec.name}`,
		value: own.value ?? "",
		errors: own.errors ?? [],
		class: own.class,
	});
	const control = () => {
		const kind = controlKind(spec as FieldSpec);
		return own.theme?.[kind] ?? defaultTheme[kind];
	};
	return <Dynamic component={control()} {...view()} />;
}
