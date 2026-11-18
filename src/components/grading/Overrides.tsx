import { createSignal, type JSX, Show } from "solid-js";
import { locale, m } from "@/i18n";
import type { OverrideRow } from "@/services/objective-review";
import Dialog from "./Dialog";
import GradeQuestionForm from "./GradeQuestionForm";
import {
	formatWhen,
	type GradeTarget,
	percentOf,
	undoOverride,
} from "./grade-actions";
import Icon from "./Icon";
import SortTable from "./SortTable";

/// An override as the island takes it: dates as ISO text.
export type OverrideItem = Omit<OverrideRow, "when" | "adjustment"> & {
	when: string;
	adjustment?: { publicId: string; updatedAt: string };
};

interface Props {
	rows: OverrideItem[];
	target: GradeTarget;
	/// Display names by username.
	names: Record<string, string>;
}

/**
 * The grades changed by hand and the sanctions on the question, one row each.
 *
 * A changed grade has a pencil and an undo; a sanction only has the undo, which revokes it.
 */
export default function Overrides(props: Props): JSX.Element {
	const [editing, setEditing] = createSignal<OverrideItem | null>(null);
	const [error, setError] = createSignal<string>();
	const nameOf = (item: OverrideItem) =>
		props.names[item.author] ?? item.author;

	async function undo(item: OverrideItem): Promise<void> {
		setError(undefined);
		const failure = await undoOverride(
			props.target,
			item.kind === "grade" && item.submission
				? { kind: "grade", submission: item.submission }
				: {
						kind: "sanction",
						adjustment: item.adjustment ?? { publicId: "", updatedAt: "" },
					},
		);
		if (failure) setError(failure);
		else window.location.reload();
	}

	return (
		<div class="flex flex-col gap-2">
			<Show when={error()}>
				<p role="alert" class="text-sm text-error">
					{error()}
				</p>
			</Show>
			<SortTable
				label={m.grades_objective_overrides_label()}
				data={props.rows}
				columns={[
					{
						title: m.grades_objective_student(),
						class: "whitespace-nowrap font-medium",
						sortKey: "name",
						sortValue: nameOf,
						render: nameOf,
					},
					{
						title: m.grades_objective_kind(),
						class: "whitespace-nowrap",
						sortKey: "kind",
						sortValue: (item: OverrideItem) => item.kind,
						render: (item: OverrideItem) => (
							<span
								class={`badge badge-sm ${item.kind === "sanction" ? "badge-error badge-soft" : "border-yellow-200 bg-yellow-50 text-yellow-800"}`}
							>
								{item.kind === "sanction"
									? m.grades_objective_kind_sanction()
									: m.grades_objective_kind_grade()}
							</span>
						),
					},
					{
						title: m.grades_objective_grade(),
						class: "whitespace-nowrap tabular-nums",
						sortKey: "final",
						sortValue: (item: OverrideItem) => item.final,
						render: (item: OverrideItem) => (
							<>
								<span class="text-muted line-through">
									{item.auto === null ? "–" : `${percentOf(item.auto)}%`}
								</span>{" "}
								→ {item.final === null ? "–" : `${percentOf(item.final)}%`}
							</>
						),
					},
					{
						title: m.grades_objective_comment(),
						class: "text-muted",
						sortKey: "comment",
						sortValue: (item: OverrideItem) => item.comment,
						render: (item: OverrideItem) => item.comment ?? "",
					},
					{
						title: m.grades_objective_when(),
						class: "text-muted text-xs whitespace-nowrap",
						sortKey: "when",
						sortValue: (item: OverrideItem) => item.when,
						render: (item: OverrideItem) => formatWhen(item.when, locale),
					},
					{
						get title() {
							return (
								<span class="sr-only">{m.grades_objective_actions()}</span>
							);
						},
						class: "text-right whitespace-nowrap",
						render: (item: OverrideItem) => (
							<span class="flex justify-end gap-2">
								<Show when={item.kind === "grade"}>
									<button
										type="button"
										class="btn btn-ghost btn-sm btn-square"
										aria-label={m.grades_objective_change_grade()}
										title={m.grades_objective_change_grade()}
										onClick={() => setEditing(item)}
									>
										<Icon name="pencil" />
									</button>
								</Show>
								<button
									type="button"
									class="btn btn-ghost btn-sm btn-square text-error"
									aria-label={m.grades_objective_undo()}
									title={m.grades_objective_undo()}
									onClick={() => void undo(item)}
								>
									<Icon name="undo" />
								</button>
							</span>
						),
					},
				]}
			/>
			<Dialog
				id="override-grade"
				size="max-w-2xl"
				open={editing() !== null}
				onClose={() => setEditing(null)}
				title={<Show when={editing()}>{(item) => nameOf(item())}</Show>}
			>
				<Show when={editing()}>
					{(item) => (
						<GradeQuestionForm
							target={props.target}
							submission={item().submission ?? null}
							author={item().author}
							current={
								item().final === null ? null : percentOf(item().final ?? 0)
							}
							onDone={() => setEditing(null)}
						/>
					)}
				</Show>
			</Dialog>
		</div>
	);
}
