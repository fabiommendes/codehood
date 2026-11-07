import { actions } from "astro:actions";
import { createSignal, type JSX, onMount } from "solid-js";
import FormAlert from "@/components/form/FormAlert";
import { errorMessage } from "@/forms/field-errors";
import { m } from "@/i18n";
import { isNumberInRange } from "@/services/rubric";
import type { GraderItem } from "@/utils/grader-state";
import type { GradingTarget } from "./grading-target";

export interface NewRubricItemProps {
	target: GradingTarget;
	/// The id of the `datalist` that suggests group paths.
	groupList: string;
	/// Called with the item the server created.
	onCreated: (item: GraderItem) => void;
}

/**
 * The form that adds an item to the rubric.
 *
 * It refuses an empty text or a value that is not a number in `[-1, 1]` before
 * asking the server, and shows the refusal on the form. Closing it is the
 * parent's business (`Escape`).
 */
export default function NewRubricItem(props: NewRubricItemProps): JSX.Element {
	const [text, setText] = createSignal("");
	const [value, setValue] = createSignal("");
	const [group, setGroup] = createSignal("");
	const [failure, setFailure] = createSignal<string | null>(null);
	const [busy, setBusy] = createSignal(false);
	let first: HTMLInputElement | undefined;

	onMount(() => first?.focus());

	async function submit(event: Event): Promise<void> {
		event.preventDefault();
		if (busy()) return;
		if (text().trim() === "") {
			setFailure(m.grades_grader_text_required());
			return;
		}
		if (!isNumberInRange(value(), -1, 1)) {
			setFailure(m.grades_grader_value_invalid());
			return;
		}
		setBusy(true);
		const { data, error } = await actions.rubric.addItem({
			...props.target,
			text: text().trim(),
			value: value().trim(),
			group: group().trim() === "" ? null : group().trim(),
		});
		setBusy(false);
		if (error) {
			setFailure(errorMessage(error));
			return;
		}
		props.onCreated(data);
	}

	return (
		<form onSubmit={submit}>
			<fieldset class="fieldset mt-3 gap-2 rounded-box border border-base-300 p-3">
				<legend class="fieldset-legend">{m.grades_grader_new_item()}</legend>
				<label class="flex flex-col gap-1 text-sm">
					<span>{m.grades_grader_text()}</span>
					<input
						ref={first}
						type="text"
						class="input input-sm w-full"
						autocomplete="off"
						value={text()}
						onInput={(event) => setText(event.currentTarget.value)}
					/>
				</label>
				<label class="flex flex-col gap-1 text-sm">
					<span>{m.grades_grader_value()}</span>
					<input
						type="text"
						inputmode="decimal"
						class="input input-sm w-full"
						autocomplete="off"
						value={value()}
						onInput={(event) => setValue(event.currentTarget.value)}
					/>
				</label>
				<label class="flex flex-col gap-1 text-sm">
					<span>{m.grades_grader_group()}</span>
					<input
						type="text"
						list={props.groupList}
						class="input input-sm w-full"
						autocomplete="off"
						value={group()}
						onInput={(event) => setGroup(event.currentTarget.value)}
					/>
				</label>
				<FormAlert error={failure() ?? undefined} />
				<button type="submit" class="btn btn-primary btn-sm" disabled={busy()}>
					{m.grades_grader_add_item()}
				</button>
			</fieldset>
		</form>
	);
}
