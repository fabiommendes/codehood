import { createSignal, type JSX, Show } from "solid-js";
import { m } from "@/i18n";
import type { GroupMember } from "@/services/objective-review";
import GradeQuestionForm from "./GradeQuestionForm";
import { type GradeTarget, percentOf } from "./grade-actions";
import Icon from "./Icon";
import SortTable from "./SortTable";

interface Props {
	members: GroupMember[];
	target: GradeTarget;
	/// Display names by username.
	names: Record<string, string>;
	/// Column title of what the student wrote.
	detailHeader?: string;
}

/**
 * The students of a group in a sortable table; the pencil opens the form that changes one student's grade under the table.
 */
export default function Members(props: Props): JSX.Element {
	const [selected, setSelected] = createSignal<string | null>(null);
	const nameOf = (member: GroupMember) =>
		props.names[member.author] ?? member.author;
	const row = () => props.members.find((entry) => entry.author === selected());
	return (
		<div class="flex flex-col gap-3">
			<SortTable
				label={m.grades_objective_members_label()}
				class="max-h-96 overflow-y-auto"
				data={props.members}
				rowClass={(member) =>
					member.author === selected() ? "bg-info/10" : undefined
				}
				columns={[
					{
						title: m.grades_objective_student(),
						class: "font-medium",
						sortKey: "name",
						sortValue: nameOf,
						render: nameOf,
					},
					...(props.members.some((member) => member.detail !== undefined)
						? [
								{
									title: props.detailHeader ?? m.grades_objective_answer(),
									class: "text-muted",
									sortKey: "detail",
									sortValue: (member: GroupMember) => member.detail ?? null,
									render: (member: GroupMember) => member.detail ?? "",
								},
							]
						: []),
					{
						title: m.grades_objective_mean_others(),
						class: "text-right tabular-nums",
						headerClass: "text-right",
						sortKey: "mean",
						sortValue: (member: GroupMember) => member.restMean,
						render: (member: GroupMember) =>
							member.restMean === null ? (
								<span class="text-muted">–</span>
							) : (
								`${percentOf(member.restMean)}%`
							),
					},
					{
						title: m.grades_objective_grade(),
						class: "text-right tabular-nums",
						headerClass: "text-right",
						sortKey: "score",
						sortValue: (member: GroupMember) => member.score,
						render: (member: GroupMember) => (
							<Show
								when={member.score !== null}
								fallback={<span class="text-muted">–</span>}
							>
								<Show
									when={member.changed && member.autoScore !== null}
									fallback={`${percentOf(member.score ?? 0)}%`}
								>
									<span class="text-muted line-through">
										{percentOf(member.autoScore ?? 0)}%
									</span>{" "}
									{percentOf(member.score ?? 0)}%{" "}
									<span class="badge badge-xs border-yellow-200 bg-yellow-50 text-yellow-800">
										{m.grades_objective_changed()}
									</span>
								</Show>
							</Show>
						),
					},
					{
						get title() {
							return (
								<span class="sr-only">{m.grades_objective_actions()}</span>
							);
						},
						class: "text-right",
						render: (member: GroupMember) => (
							<button
								type="button"
								class="btn btn-ghost btn-sm btn-square"
								aria-label={m.grades_objective_change_grade()}
								title={m.grades_objective_change_grade()}
								aria-pressed={selected() === member.author}
								onClick={() =>
									setSelected(
										selected() === member.author ? null : member.author,
									)
								}
							>
								<Icon name="pencil" />
							</button>
						),
					},
				]}
			/>
			<Show when={row()}>
				{(member) => (
					<div class="flex flex-col gap-2">
						<p class="text-sm font-medium">{nameOf(member())}</p>
						<GradeQuestionForm
							target={props.target}
							submission={member().submission}
							author={member().author}
							current={
								member().score === null ? null : percentOf(member().score ?? 0)
							}
							onDone={() => setSelected(null)}
						/>
					</div>
				)}
			</Show>
		</div>
	);
}
