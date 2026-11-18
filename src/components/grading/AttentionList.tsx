import { createSignal, For, type JSX, Show } from "solid-js";
import { isPercentScore, SCORE_ERROR } from "@/core/score";
import { m } from "@/i18n";
import type { AttentionRow } from "@/services/objective-review";
import { type GradeTarget, recordGrade } from "./grade-actions";
import Icon from "./Icon";

interface Props {
	rows: AttentionRow[];
	target: GradeTarget;
	/// Display names by username.
	names: Record<string, string>;
	/// The page that lists the open regrade requests.
	regradesHref: string;
}

/// The form of an answer with no grade: a percentage, "mark as right" and "give grade".
function PendingForm(props: {
	target: GradeTarget;
	row: Extract<AttentionRow, { kind: "pending" }>;
}): JSX.Element {
	const [score, setScore] = createSignal("");
	const [error, setError] = createSignal<string>();
	const [busy, setBusy] = createSignal(false);

	async function save(text: string): Promise<void> {
		if (!isPercentScore(text)) {
			setError(SCORE_ERROR);
			return;
		}
		setBusy(true);
		setError(undefined);
		const failure = await recordGrade(
			props.target,
			{ submission: props.row.submission, author: props.row.author },
			{ score: text },
		);
		if (failure) {
			setError(failure);
			setBusy(false);
			return;
		}
		window.location.reload();
	}

	return (
		<form
			noValidate
			class="flex items-center gap-2"
			onSubmit={(event) => {
				event.preventDefault();
				void save(score());
			}}
		>
			<input
				type="number"
				min="0"
				max="100"
				placeholder={m.grades_objective_score_placeholder()}
				class="input input-sm w-24"
				aria-label={m.grades_objective_grade_label()}
				value={score()}
				onInput={(event) => setScore(event.currentTarget.value)}
			/>
			<button
				type="button"
				class="btn btn-success btn-soft btn-sm"
				disabled={busy()}
				onClick={() => void save("100")}
			>
				{m.grades_objective_mark_correct()}
			</button>
			<button type="submit" class="btn btn-primary btn-sm" disabled={busy()}>
				{m.grades_objective_give_grade()}
			</button>
			<Show when={error()}>
				<span role="alert" class="text-xs text-error">
					{error()}
				</span>
			</Show>
		</form>
	);
}

/**
 * The answers that need the instructor: those with no grade, which can be graded in place, and those with an open regrade request.
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
							{row.kind === "pending"
								? m.grades_objective_pending()
								: m.grades_objective_regrade()}
						</span>
						<span class="min-w-48 flex-1 text-muted">
							{row.kind === "pending"
								? m.grades_objective_pending_detail()
								: m.grades_objective_regrade_detail()}
						</span>
						{row.kind === "pending" ? (
							<PendingForm target={props.target} row={row} />
						) : (
							<a
								href={`${props.regradesHref}#regrade-${row.request}`}
								class="btn btn-ghost btn-sm btn-square"
								aria-label={m.grades_objective_view_request()}
								title={m.grades_objective_view_request()}
							>
								<Icon name="message" />
							</a>
						)}
					</li>
				)}
			</For>
		</ul>
	);
}
