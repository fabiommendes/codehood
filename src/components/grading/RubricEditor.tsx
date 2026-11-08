import { actions } from "astro:actions";
import { createSignal, For, type JSX, Show } from "solid-js";
import FormAlert from "@/components/form/FormAlert";
import Alert from "@/components/ui/Alert";
import { errorMessage } from "@/forms/field-errors";
import { m } from "@/i18n";
import { isNumberInRange } from "@/services/rubric";
import type { GraderItem } from "@/utils/grader-state";
import type { GradingTarget } from "./grading-target";

export interface RubricEditorProps {
	target: GradingTarget;
	base: string;
	/// The items that can still be edited, retired ones left out.
	items: GraderItem[];
	/// The id of the `datalist` that suggests group paths.
	groupList: string;
	/// Called once the server holds a change, so the view can read the rubric again.
	onChanged: () => Promise<void>;
}

/// The fields of an item the editor lets the grader change, as typed.
interface Patch {
	text?: string;
	value?: string;
	group?: string;
	comment?: string;
	feedback?: string;
}

/// A child of an item being split, as typed.
interface Child {
	text: string;
	value: string;
}

/// How many answers a pending change moves, and how many of those are released.
interface Moved {
	passes: number;
	released: number;
}

/**
 * The rubric as a list to edit: base, value and details of each item, delete, split, and rename a group.
 *
 * Changes to the base, values and deletions are held until "Apply changes".
 * When they move any score, the page says how many and waits for "Confirm";
 * nothing is written before that. Splitting and renaming write at once, since
 * they keep every score.
 */
export default function RubricEditor(props: RubricEditorProps): JSX.Element {
	const [base, setBase] = createSignal<string | undefined>();
	const [patches, setPatches] = createSignal<Record<string, Patch>>({});
	const [deleted, setDeleted] = createSignal<string[]>([]);
	const [moved, setMoved] = createSignal<Moved | null>(null);
	const [failure, setFailure] = createSignal<string | null>(null);
	const [busy, setBusy] = createSignal(false);
	const [splitting, setSplitting] = createSignal<string | null>(null);

	function patch(key: string, fields: Patch): void {
		setPatches({ ...patches(), [key]: { ...patches()[key], ...fields } });
		setMoved(null);
	}

	/// The edit to send, or `null` after setting `failure` for a typed value that is refused.
	function change() {
		const items = [];
		for (const item of props.items) {
			const typed = patches()[item.key];
			if (!typed || deleted().includes(item.key)) continue;
			const diff: {
				text?: string;
				value?: string;
				group?: string | null;
				comment?: string | null;
				feedback?: string | null;
			} = {};
			if (typed.text !== undefined && typed.text.trim() !== item.text) {
				diff.text = typed.text.trim();
			}
			if (typed.value !== undefined && typed.value.trim() !== item.value) {
				diff.value = typed.value.trim();
			}
			if (
				typed.group !== undefined &&
				typed.group.trim() !== (item.group ?? "")
			) {
				diff.group = typed.group.trim() === "" ? null : typed.group.trim();
			}
			if (
				typed.comment !== undefined &&
				typed.comment !== (item.comment ?? "")
			) {
				diff.comment = typed.comment === "" ? null : typed.comment;
			}
			if (
				typed.feedback !== undefined &&
				typed.feedback !== (item.feedback ?? "")
			) {
				diff.feedback = typed.feedback === "" ? null : typed.feedback;
			}
			if (diff.text === "") return refuse(m.grades_grader_text_required());
			if (diff.value !== undefined && !isNumberInRange(diff.value, -1, 1)) {
				return refuse(m.grades_grader_value_invalid());
			}
			if (Object.keys(diff).length > 0) items.push({ key: item.key, ...diff });
		}
		const newBase = base()?.trim();
		if (newBase !== undefined && !isNumberInRange(newBase, 0, 1)) {
			return refuse(m.grades_grader_value_invalid());
		}
		return {
			base:
				newBase !== undefined && newBase !== props.base ? newBase : undefined,
			items,
			deleted: deleted(),
		};
	}

	function refuse(message: string): null {
		setFailure(message);
		return null;
	}

	async function write(dryRun: boolean): Promise<Moved | null> {
		const edit = change();
		if (edit === null) return null;
		const { data, error } = await actions.rubric.edit({
			...props.target,
			...edit,
			dryRun,
		});
		if (error) {
			setFailure(errorMessage(error));
			return null;
		}
		return data;
	}

	async function commit(): Promise<void> {
		if ((await write(false)) === null) return;
		await props.onChanged();
		setBase(undefined);
		setPatches({});
		setDeleted([]);
		setMoved(null);
	}

	async function apply(): Promise<void> {
		if (busy()) return;
		setFailure(null);
		setBusy(true);
		const edit = change();
		if (
			edit !== null &&
			(edit.base !== undefined ||
				edit.items.length > 0 ||
				edit.deleted.length > 0)
		) {
			const count = await write(true);
			if (count !== null) {
				if (count.passes > 0) setMoved(count);
				else await commit();
			}
		}
		setBusy(false);
	}

	async function confirm(): Promise<void> {
		setBusy(true);
		await commit();
		setBusy(false);
	}

	function toggleDelete(key: string): void {
		setDeleted(
			deleted().includes(key)
				? deleted().filter((entry) => entry !== key)
				: [...deleted(), key],
		);
		setMoved(null);
	}

	return (
		<div class="flex flex-col gap-3">
			<label class="flex items-center gap-2 text-sm">
				<span class="font-medium">{m.grades_grader_base()}</span>
				<input
					type="text"
					inputmode="decimal"
					class="input input-sm w-24"
					autocomplete="off"
					value={base() ?? props.base}
					onInput={(event) => {
						setBase(event.currentTarget.value);
						setMoved(null);
					}}
				/>
			</label>

			<ul
				aria-label={m.grades_rubric_items_label()}
				class="flex flex-col gap-2"
			>
				<For each={props.items}>
					{(item) => (
						<li class="rounded-box border border-base-300 p-2 text-sm">
							<p class="flex items-center gap-2">
								<span
									class="min-w-0 flex-1"
									classList={{ "line-through": deleted().includes(item.key) }}
								>
									{item.text}
								</span>
								<Show when={deleted().includes(item.key)}>
									<span class="badge badge-error badge-sm">
										{m.grades_grader_will_delete()}
									</span>
								</Show>
							</p>
							<div class="mt-1 flex flex-wrap items-center gap-2">
								<input
									type="text"
									inputmode="decimal"
									aria-label={m.grades_grader_value()}
									class="input input-sm w-24"
									autocomplete="off"
									value={patches()[item.key]?.value ?? item.value}
									onInput={(event) =>
										patch(item.key, { value: event.currentTarget.value })
									}
								/>
								<button
									type="button"
									class="btn btn-ghost btn-sm"
									onClick={() =>
										setSplitting(splitting() === item.key ? null : item.key)
									}
								>
									{m.grades_grader_split()}
								</button>
								<button
									type="button"
									class="btn btn-ghost btn-sm"
									onClick={() => toggleDelete(item.key)}
								>
									{deleted().includes(item.key)
										? m.grades_grader_undo_delete()
										: m.grades_grader_delete()}
								</button>
							</div>
							<details class="mt-1">
								<summary class="cursor-pointer text-xs text-muted">
									{m.grades_grader_details()}
								</summary>
								<div class="mt-1 flex flex-col gap-1">
									<ItemField
										label={m.grades_grader_text()}
										value={patches()[item.key]?.text ?? item.text}
										onInput={(text) => patch(item.key, { text })}
									/>
									<ItemField
										label={m.grades_grader_group()}
										list={props.groupList}
										value={patches()[item.key]?.group ?? item.group ?? ""}
										onInput={(group) => patch(item.key, { group })}
									/>
									<ItemField
										label={m.grades_rubric_private_comment()}
										value={patches()[item.key]?.comment ?? item.comment ?? ""}
										onInput={(comment) => patch(item.key, { comment })}
									/>
									<ItemField
										label={m.grades_rubric_student_feedback()}
										value={patches()[item.key]?.feedback ?? item.feedback ?? ""}
										onInput={(feedback) => patch(item.key, { feedback })}
									/>
								</div>
							</details>
							<Show when={splitting() === item.key}>
								<SplitItem
									target={props.target}
									item={item}
									onDone={async () => {
										setSplitting(null);
										await props.onChanged();
									}}
								/>
							</Show>
						</li>
					)}
				</For>
			</ul>

			<FormAlert error={failure() ?? undefined} />
			<Show when={moved()}>
				{(count) => (
					<Alert variant="warning" class="flex-col items-start">
						<span>
							{m.grades_grader_change_warning({
								count: count().passes,
								released: count().released,
							})}
						</span>
						<span class="flex gap-2">
							<button
								type="button"
								class="btn btn-warning btn-sm"
								disabled={busy()}
								onClick={confirm}
							>
								{m.grades_grader_confirm()}
							</button>
							<button
								type="button"
								class="btn btn-ghost btn-sm"
								onClick={() => setMoved(null)}
							>
								{m.grades_cancel()}
							</button>
						</span>
					</Alert>
				)}
			</Show>
			<button
				type="button"
				class="btn btn-primary btn-sm self-start"
				disabled={busy()}
				onClick={apply}
			>
				{m.grades_grader_apply()}
			</button>

			<RenameGroup
				target={props.target}
				groupList={props.groupList}
				onDone={props.onChanged}
			/>
		</div>
	);
}

/// A labelled text input of the details of an item.
function ItemField(props: {
	label: string;
	value: string;
	list?: string;
	onInput: (value: string) => void;
}): JSX.Element {
	return (
		<label class="flex flex-col gap-0.5 text-xs">
			<span>{props.label}</span>
			<input
				type="text"
				class="input input-sm w-full"
				autocomplete="off"
				list={props.list}
				value={props.value}
				onInput={(event) => props.onInput(event.currentTarget.value)}
			/>
		</label>
	);
}

/// The form that retires an item and replaces it with children.
function SplitItem(props: {
	target: GradingTarget;
	item: GraderItem;
	onDone: () => Promise<void>;
}): JSX.Element {
	const [children, setChildren] = createSignal<Child[]>([
		{ text: "", value: "" },
		{ text: "", value: "" },
	]);
	const [failure, setFailure] = createSignal<string | null>(null);
	const [busy, setBusy] = createSignal(false);

	function set(index: number, fields: Partial<Child>): void {
		setChildren(
			children().map((child, i) =>
				i === index ? { ...child, ...fields } : child,
			),
		);
	}

	async function submit(event: Event): Promise<void> {
		event.preventDefault();
		if (busy()) return;
		const typed = children().map((child) => ({
			text: child.text.trim(),
			value: child.value.trim(),
		}));
		if (typed.some((child) => child.text === "")) {
			setFailure(m.grades_grader_text_required());
			return;
		}
		if (typed.some((child) => !isNumberInRange(child.value, -1, 1))) {
			setFailure(m.grades_grader_value_invalid());
			return;
		}
		setBusy(true);
		const { error } = await actions.rubric.splitItem({
			...props.target,
			key: props.item.key,
			children: typed,
		});
		setBusy(false);
		if (error) {
			setFailure(errorMessage(error));
			return;
		}
		await props.onDone();
	}

	return (
		<form onSubmit={submit}>
			<fieldset class="fieldset mt-2 gap-2 rounded-box bg-base-200/50 p-2">
				<legend class="fieldset-legend">{m.grades_grader_split_item()}</legend>
				<ul aria-label={m.grades_grader_children()} class="flex flex-col gap-2">
					<For each={children()}>
						{(child, index) => (
							<li class="flex flex-col gap-1">
								<label class="flex flex-col gap-0.5 text-xs">
									<span>{m.grades_grader_text()}</span>
									<input
										type="text"
										class="input input-sm w-full"
										autocomplete="off"
										value={child.text}
										onInput={(event) =>
											set(index(), { text: event.currentTarget.value })
										}
									/>
								</label>
								<label class="flex flex-col gap-0.5 text-xs">
									<span>{m.grades_grader_value()}</span>
									<input
										type="text"
										inputmode="decimal"
										class="input input-sm w-24"
										autocomplete="off"
										value={child.value}
										onInput={(event) =>
											set(index(), { value: event.currentTarget.value })
										}
									/>
								</label>
							</li>
						)}
					</For>
				</ul>
				<FormAlert error={failure() ?? undefined} />
				<div class="flex gap-2">
					<button
						type="button"
						class="btn btn-ghost btn-sm"
						onClick={() =>
							setChildren([...children(), { text: "", value: "" }])
						}
					>
						{m.grades_grader_add_child()}
					</button>
					<button
						type="submit"
						class="btn btn-primary btn-sm"
						disabled={busy()}
					>
						{m.grades_grader_split_item()}
					</button>
				</div>
			</fieldset>
		</form>
	);
}

/// The form that moves a group, and everything under it, to another path.
function RenameGroup(props: {
	target: GradingTarget;
	groupList: string;
	onDone: () => Promise<void>;
}): JSX.Element {
	const [from, setFrom] = createSignal("");
	const [to, setTo] = createSignal("");
	const [note, setNote] = createSignal<string | null>(null);
	const [failure, setFailure] = createSignal<string | null>(null);

	async function submit(event: Event): Promise<void> {
		event.preventDefault();
		setFailure(null);
		setNote(null);
		const { data, error } = await actions.rubric.renameGroup({
			...props.target,
			from: from(),
			to: to(),
		});
		if (error) {
			setFailure(errorMessage(error));
			return;
		}
		setNote(
			[m.grades_grader_renamed({ count: data.renamed }), ...data.warnings].join(
				" ",
			),
		);
		await props.onDone();
	}

	return (
		<details>
			<summary class="cursor-pointer text-sm">
				{m.grades_grader_rename_group()}
			</summary>
			<form class="mt-2 flex flex-col gap-2" onSubmit={submit}>
				<ItemField
					label={m.grades_grader_rename_from()}
					list={props.groupList}
					value={from()}
					onInput={setFrom}
				/>
				<ItemField
					label={m.grades_grader_rename_to()}
					list={props.groupList}
					value={to()}
					onInput={setTo}
				/>
				<FormAlert error={failure() ?? undefined} />
				<Show when={note()}>
					<p class="text-sm text-muted">{note()}</p>
				</Show>
				<button type="submit" class="btn btn-sm self-start">
					{m.grades_grader_rename()}
				</button>
			</form>
		</details>
	);
}
