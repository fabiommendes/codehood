import { actions } from "astro:actions";
import { createSignal, For, type JSX, Show } from "solid-js";
import Field from "@/components/form/Field";
import FormAlert from "@/components/form/FormAlert";
import type { BlankGrade } from "@/core/schemas";
import { isPercentScore, SCORE_ERROR } from "@/core/score";
import { errorMessage } from "@/forms/field-errors";
import { m } from "@/i18n";
import { FOCUS_KEY } from "./focus";

export interface BlankGradeFormProps {
	/// The course's URL segments and the exam slug, as the grading action takes them.
	discipline: string;
	course: string;
	exam: string;
	/// The `publicId` of the fill-in answer being graded.
	submission: string;
	/// The ids of the blanks only an instructor can grade, in definition order.
	blanks: string[];
	/// When given, the form offers a Cancel button that calls it.
	onCancel?: () => void;
}

/**
 * The form that grades a fill-in answer blank by blank: a percentage and a
 * comment for each pending blank, and a comment on the whole answer.
 *
 * The server combines the blank grades with the blanks the library scores
 * itself into the question score. Saving reloads the page, like `GradeForm`.
 */
export default function BlankGradeForm(
	props: BlankGradeFormProps,
): JSX.Element {
	const [scores, setScores] = createSignal<Record<string, string>>({});
	const [comments, setComments] = createSignal<Record<string, string>>({});
	const [comment, setComment] = createSignal("");
	const [invalid, setInvalid] = createSignal<ReadonlySet<string>>(new Set());
	const [error, setError] = createSignal<string>();
	const [busy, setBusy] = createSignal(false);

	async function submit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const wrong = props.blanks.filter(
			(id) => !isPercentScore(scores()[id] ?? ""),
		);
		setInvalid(new Set(wrong));
		if (wrong.length > 0) return;

		const blanks: Record<string, BlankGrade> = {};
		for (const id of props.blanks) {
			const text = comments()[id]?.trim();
			blanks[id] = {
				score: Number((scores()[id] ?? "").trim()) / 100,
				...(text ? { comment: text } : {}),
			};
		}

		setBusy(true);
		setError(undefined);
		const { error } = await actions.grading.gradeBlanks({
			discipline: props.discipline,
			course: props.course,
			exam: props.exam,
			submission: props.submission,
			blanks,
			comment: comment(),
		});
		if (error) {
			setError(errorMessage(error));
			setBusy(false);
			return;
		}
		sessionStorage.setItem(FOCUS_KEY, window.location.pathname);
		window.location.reload();
	}

	return (
		<form noValidate class="mt-4 flex flex-col gap-3" onSubmit={submit}>
			<FormAlert error={error()} />
			<For each={props.blanks}>
				{(id, index) => (
					<fieldset class="rounded-box border border-base-300 px-4 pb-3">
						<legend class="px-1 font-mono text-sm">
							{m.grades_blank_legend({ blank: id })}
						</legend>
						<div class="grid gap-x-4 sm:grid-cols-[8rem_1fr]">
							<Field
								name={`score-${id}`}
								id={`blank-score-${props.submission}-${id}`}
								kind="text"
								required
								label={m.forms_label_score_percent()}
								attrs={{}}
								value={scores()[id] ?? ""}
								errors={invalid().has(id) ? [SCORE_ERROR] : []}
								control={{
									inputmode: "numeric",
									autocomplete: "off",
									...(index() === 0 ? { "data-score-input": "" } : {}),
								}}
								onInput={(event) =>
									setScores((current) => ({
										...current,
										[id]: (event.target as HTMLInputElement).value,
									}))
								}
							/>
							<Field
								name={`comment-${id}`}
								id={`blank-comment-${props.submission}-${id}`}
								kind="text"
								required={false}
								label={m.forms_label_comment()}
								attrs={{}}
								value={comments()[id] ?? ""}
								onInput={(event) =>
									setComments((current) => ({
										...current,
										[id]: (event.target as HTMLInputElement).value,
									}))
								}
							/>
						</div>
					</fieldset>
				)}
			</For>
			<Field
				name="comment"
				id={`blank-comment-${props.submission}`}
				kind="textarea"
				required={false}
				label={m.forms_label_comment()}
				attrs={{}}
				value={comment()}
				onInput={(event) =>
					setComment((event.target as HTMLTextAreaElement).value)
				}
			/>
			<div class="flex gap-2">
				<button type="submit" class="btn btn-primary" disabled={busy()}>
					{m.grades_form_save()}
				</button>
				<Show when={props.onCancel}>
					{(cancel) => (
						<button type="button" class="btn btn-ghost" onClick={cancel()}>
							{m.grades_cancel()}
						</button>
					)}
				</Show>
			</div>
		</form>
	);
}
