import { For, type JSX } from "solid-js";
import { m } from "@/i18n";
import type { AttentionRow } from "@/services/objective-review";
import Icon from "./Icon";

/// An attention row of an open regrade request.
type RegradeRow = Extract<AttentionRow, { kind: "regrade" }>;

interface Props {
	rows: RegradeRow[];
	/// Display names by username.
	names: Record<string, string>;
	/// The page that lists the open regrade requests.
	regradesHref: string;
}

/**
 * The answers with an open regrade request, which need the instructor.
 */
export default function AttentionList(props: Props): JSX.Element {
	return (
		<ul class="mt-3 overflow-hidden rounded-box border border-warning/40 bg-base-100">
			<For each={props.rows}>
				{(row) => (
					<li class="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-edge px-4 py-2 text-sm first:border-t-0">
						<span class="w-44 shrink-0 font-medium">
							{props.names[row.author] ?? row.author}
						</span>
						<span class="badge badge-warning badge-soft badge-sm">
							{m.grades_objective_regrade()}
						</span>
						<span class="min-w-48 flex-1 text-muted">
							{m.grades_objective_regrade_detail()}
						</span>
						<a
							href={`${props.regradesHref}#regrade-${row.request}`}
							class="btn btn-ghost btn-sm btn-square"
							aria-label={m.grades_objective_view_request()}
							title={m.grades_objective_view_request()}
						>
							<Icon name="message" />
						</a>
					</li>
				)}
			</For>
		</ul>
	);
}
