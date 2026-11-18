import { createSignal, type JSX, Show } from "solid-js";
import { isPercentScore, SCORE_ERROR } from "@/core/score";
import { m } from "@/i18n";
import AdjustmentActions from "./AdjustmentActions";
import AdjustmentDialog, { type AdjustmentPreview } from "./AdjustmentDialog";
import { DialogError, Preview } from "./adjustment-fields";
import Dialog from "./Dialog";
import {
	type GradeTarget,
	percentOf,
	recordGrade,
	undoOverride,
} from "./grade-actions";
import Icon from "./Icon";

interface Props {
	/// The course's URL segments, the exam and the question, as the grading actions take them.
	target: GradeTarget;
	/// The question's position in the exam, from 1.
	number: number;
	/// The student's username.
	author: string;
	/// The `publicId` of the counting submission, or `null` when the student left the question blank.
	submission: string | null;
	/// The question's score now, after any adjustment, or `null` when it has none.
	score: number | null;
	/// The question's score before the adjustment on it, or `null` when it has none.
	unadjusted: number | null;
	/// Whether the exam takes adjustments; a practice exam does not.
	adjustable: boolean;
	/// The active adjustment on this question, which replaces the hammer.
	adjustment?: {
		publicId: string;
		updatedAt: string;
		value: string;
		reason: string | null;
		notes: string | null;
		/// The adjustment as `adjustmentLabel` writes it.
		label: string;
	};
}

/**
 * The pencil that changes the grade of one question and the hammer that sanctions it, with their dialogs.
 *
 * A question that is already sanctioned shows the badge of its adjustment and the buttons to edit or revoke it.
 */
export default function QuestionActions(props: Props): JSX.Element {
	const [editing, setEditing] = createSignal(false);
	const [sanctioning, setSanctioning] = createSignal(false);
	const [grade, setGrade] = createSignal(
		props.score === null ? "" : String(percentOf(props.score)),
	);
	const [comment, setComment] = createSignal("");
	const [error, setError] = createSignal<string>();
	const [busy, setBusy] = createSignal(false);
	const id = `${props.target.question}`;

	async function save(text: string): Promise<void> {
		if (!isPercentScore(text)) {
			setError(SCORE_ERROR);
			return;
		}
		setBusy(true);
		setError(undefined);
		const failure = await recordGrade(
			props.target,
			{ submission: props.submission, author: props.author },
			{ score: text, comment: comment() },
		);
		if (failure) {
			setError(failure);
			setBusy(false);
			return;
		}
		window.location.reload();
	}

	/// The question's score now, and the score it would keep.
	const preview: AdjustmentPreview = ({ fraction }) => ({
		from: props.unadjusted,
		to:
			props.unadjusted === null
				? null
				: props.unadjusted > 0
					? props.unadjusted * fraction
					: props.unadjusted,
	});
	const percentText = (score: number | null) =>
		score === null ? m.grades_adjustment_no_answer() : `${percentOf(score)}%`;
	const typedGrade = () => Number(grade());

	return (
		<span class="flex shrink-0 items-center gap-3">
			<button
				type="button"
				class="btn btn-ghost btn-sm btn-square"
				aria-label={m.grades_objective_change_grade()}
				title={m.grades_objective_change_grade()}
				onClick={() => {
					setError(undefined);
					setEditing(true);
				}}
			>
				<Icon name="pencil" />
			</button>
			<Show when={props.adjustable}>
				<Show
					when={props.adjustment}
					fallback={
						<button
							type="button"
							class="btn btn-ghost btn-sm btn-square text-error"
							aria-label={m.grades_adjustment_sanction_question()}
							title={m.grades_adjustment_sanction_question()}
							onClick={() => setSanctioning(true)}
						>
							<Icon name="gavel" />
						</button>
					}
				>
					{(adjustment) => (
						<AdjustmentActions
							discipline={props.target.discipline}
							course={props.target.course}
							exam={props.target.exam}
							adjustment={adjustment().publicId}
							updatedAt={adjustment().updatedAt}
							op="FACTOR"
							value={adjustment().value}
							reason={adjustment().reason}
							notes={adjustment().notes}
							label={adjustment().label}
							onQuestion
						/>
					)}
				</Show>
			</Show>

			<Dialog
				id={`grade-dialog-${id}`}
				title={m.grades_adjustment_grade_dialog_title({
					number: props.number,
				})}
				size="max-w-md"
				open={editing()}
				onClose={() => setEditing(false)}
				action={{
					label: m.grades_objective_save(),
					tone: "btn-primary",
					disabled: busy(),
					onClick: () => void save(grade()),
				}}
			>
				<div class="flex flex-col gap-3 text-left">
					<DialogError message={error()} />
					<fieldset class="fieldset py-0">
						<div class="flex items-center gap-3">
							<label class="input input-sm w-40">
								<input
									type="text"
									inputmode="numeric"
									autocomplete="off"
									aria-label={m.grades_objective_grade_label()}
									value={grade()}
									onInput={(event) => setGrade(event.currentTarget.value)}
								/>
								<span class="label">%</span>
							</label>
							<Show when={isPercentScore(grade())}>
								<Preview
									from={percentText(props.score)}
									to={`${typedGrade()}%`}
									tone="text-success"
								/>
							</Show>
							<button
								type="button"
								class="btn btn-success btn-soft btn-xs ml-auto"
								disabled={busy()}
								onClick={() => void save("100")}
							>
								{m.grades_objective_mark_correct()}
							</button>
						</div>
						<p class="label whitespace-normal">
							{m.grades_adjustment_grade_hint()}
						</p>
					</fieldset>
					<fieldset class="fieldset py-0">
						<legend class="fieldset-legend py-0.5">
							<label for={`grade-dialog-${id}-comment`}>
								{m.grades_objective_comment_optional()}
							</label>
						</legend>
						<textarea
							id={`grade-dialog-${id}-comment`}
							class="textarea textarea-sm w-full"
							rows={2}
							value={comment()}
							onInput={(event) => setComment(event.currentTarget.value)}
						/>
					</fieldset>
				</div>
			</Dialog>

			<Show when={props.adjustable && !props.adjustment}>
				<AdjustmentDialog
					id={`sanction-dialog-${id}`}
					open={sanctioning()}
					onClose={() => setSanctioning(false)}
					discipline={props.target.discipline}
					course={props.target.course}
					exam={props.target.exam}
					usernames={[props.author]}
					kind="sanction"
					question={props.target.question}
					title={m.grades_adjustment_sanction_question()}
					submitLabel={m.grades_adjustment_sanction_question()}
					preview={preview}
				/>
			</Show>
		</span>
	);
}

/** The "Undo" button of a question whose grade was changed by hand. */
export function UndoGrade(props: {
	target: GradeTarget;
	/// The `publicId` of the answer whose change is undone.
	submission: string;
}): JSX.Element {
	const [busy, setBusy] = createSignal(false);
	const [error, setError] = createSignal<string>();
	return (
		<>
			<button
				type="button"
				class="btn btn-ghost btn-sm btn-square text-error"
				aria-label={m.grades_objective_undo()}
				title={m.grades_objective_undo()}
				disabled={busy()}
				onClick={async () => {
					setBusy(true);
					const failure = await undoOverride(props.target, {
						kind: "grade",
						submission: props.submission,
					});
					if (failure) {
						setError(failure);
						setBusy(false);
						return;
					}
					window.location.reload();
				}}
			>
				<Icon name="undo" />
			</button>
			<DialogError message={error()} />
		</>
	);
}
