import { For, type JSX, Show } from "solid-js";
import type { FieldView } from "@/forms/form-state";

/// Props of a theme component: the field view plus the caller's extra classes.
export type ControlProps = FieldView & { class?: string };

/// Keys of a theme: the field `kind`, or the `widget` that replaces the
/// default control (`radio` for an enum, `toggle` for a boolean).
export type ControlKind = FieldView["kind"] | "radio" | "toggle";

/** Maps a control kind to the component that renders the whole field. */
export type FieldTheme = Partial<
	Record<ControlKind, (props: ControlProps) => JSX.Element>
>;

/// Id of the hint paragraph.
const hintId = (props: ControlProps) => `${props.id}-hint`;
/// Id of the error paragraph.
const errorId = (props: ControlProps) => `${props.id}-error`;

/// Ids that describe the control, for `aria-describedby`.
function describedBy(props: ControlProps): string | undefined {
	const ids = [
		props.hint ? hintId(props) : undefined,
		props.errors.length > 0 ? errorId(props) : undefined,
	].filter(Boolean);
	return ids.length > 0 ? ids.join(" ") : undefined;
}

function Messages(props: ControlProps): JSX.Element {
	return (
		<>
			<Show when={props.hint}>
				<p id={hintId(props)} class="label whitespace-normal">
					{props.hint}
				</p>
			</Show>
			<Show when={props.errors.length > 0}>
				<p id={errorId(props)} class="label whitespace-normal text-error">
					{props.errors.join(" ")}
				</p>
			</Show>
		</>
	);
}

function Legend(props: ControlProps): JSX.Element {
	return (
		<legend class="fieldset-legend">
			<label for={props.id}>{props.label}</label>
		</legend>
	);
}

const INPUT_TYPES: Partial<Record<ControlKind, string>> = {
	text: "text",
	email: "email",
	url: "url",
	number: "number",
	date: "date",
	datetime: "datetime-local",
};

function InputField(props: ControlProps): JSX.Element {
	return (
		<fieldset class="fieldset">
			<Legend {...props} />
			<input
				id={props.id}
				name={props.name}
				type={props.attrs.type ?? INPUT_TYPES[props.kind] ?? "text"}
				class={[
					"input w-full",
					props.errors.length > 0 && "input-error",
					props.class,
				]
					.filter(Boolean)
					.join(" ")}
				value={props.value}
				placeholder={props.placeholder}
				required={props.required}
				minlength={props.attrs.minlength}
				maxlength={props.attrs.maxlength}
				min={props.attrs.min}
				max={props.attrs.max}
				step={props.attrs.step}
				pattern={props.attrs.pattern}
				aria-invalid={props.errors.length > 0 ? "true" : undefined}
				aria-describedby={describedBy(props)}
			/>
			<Messages {...props} />
		</fieldset>
	);
}

function TextareaField(props: ControlProps): JSX.Element {
	return (
		<fieldset class="fieldset">
			<Legend {...props} />
			<textarea
				id={props.id}
				name={props.name}
				class={[
					"textarea h-24 w-full",
					props.errors.length > 0 && "textarea-error",
					props.class,
				]
					.filter(Boolean)
					.join(" ")}
				placeholder={props.placeholder}
				required={props.required}
				minlength={props.attrs.minlength}
				maxlength={props.attrs.maxlength}
				aria-invalid={props.errors.length > 0 ? "true" : undefined}
				aria-describedby={describedBy(props)}
			>
				{props.value}
			</textarea>
			<Messages {...props} />
		</fieldset>
	);
}

function SelectField(props: ControlProps): JSX.Element {
	return (
		<fieldset class="fieldset">
			<Legend {...props} />
			<select
				id={props.id}
				name={props.name}
				class={[
					"select w-full",
					props.errors.length > 0 && "select-error",
					props.class,
				]
					.filter(Boolean)
					.join(" ")}
				required={props.required}
				aria-invalid={props.errors.length > 0 ? "true" : undefined}
				aria-describedby={describedBy(props)}
			>
				<option value="" disabled={props.required} selected={!props.value}>
					{props.placeholder ?? `Pick ${props.label.toLowerCase()}`}
				</option>
				<For each={props.options}>
					{(option) => (
						<option
							value={option.value}
							selected={option.value === props.value}
						>
							{option.label}
						</option>
					)}
				</For>
			</select>
			<Messages {...props} />
		</fieldset>
	);
}

function RadioField(props: ControlProps): JSX.Element {
	return (
		<fieldset
			class="fieldset"
			aria-invalid={props.errors.length > 0 ? "true" : undefined}
			aria-describedby={describedBy(props)}
		>
			<legend class="fieldset-legend">{props.label}</legend>
			<For each={props.options}>
				{(option) => (
					<label class="label cursor-pointer gap-2 text-base-content">
						<input
							type="radio"
							name={props.name}
							value={option.value}
							class={[
								"radio radio-primary",
								props.errors.length > 0 && "radio-error",
								props.class,
							]
								.filter(Boolean)
								.join(" ")}
							checked={option.value === props.value}
							required={props.required}
						/>
						{option.label}
					</label>
				)}
			</For>
			<Messages {...props} />
		</fieldset>
	);
}

/// A checkbox or toggle; `control` is the daisyUI class of the input.
function SwitchField(props: ControlProps & { control: string }): JSX.Element {
	return (
		<fieldset class="fieldset">
			<label class="label cursor-pointer gap-2 text-base-content">
				<input
					id={props.id}
					type="checkbox"
					name={props.name}
					value="true"
					class={[
						props.control,
						props.errors.length > 0 && `${props.control.split(" ")[0]}-error`,
						props.class,
					]
						.filter(Boolean)
						.join(" ")}
					checked={props.value === "true" || props.value === "on"}
					aria-invalid={props.errors.length > 0 ? "true" : undefined}
					aria-describedby={describedBy(props)}
				/>
				{props.label}
			</label>
			<Messages {...props} />
		</fieldset>
	);
}

/** The daisyUI theme, matching `src/pages/design/forms.astro`. */
export const defaultTheme: Required<FieldTheme> = {
	text: InputField,
	email: InputField,
	url: InputField,
	number: InputField,
	date: InputField,
	datetime: InputField,
	textarea: TextareaField,
	enum: SelectField,
	radio: RadioField,
	boolean: (props) => (
		<SwitchField {...props} control="checkbox checkbox-primary" />
	),
	toggle: (props) => <SwitchField {...props} control="toggle toggle-primary" />,
};
