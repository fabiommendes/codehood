import { actions } from "astro:actions";
import {
	createEffect,
	createMemo,
	createSignal,
	type JSX,
	on,
	onCleanup,
	onMount,
	Show,
	untrack,
} from "solid-js";
import FormAlert from "@/components/form/FormAlert";
import { scoreValue } from "@/core/score";
import { errorMessage } from "@/forms/field-errors";
import { m } from "@/i18n";
import { formatScore } from "@/services/exam-result";
import { isNumberInRange, rubricScore } from "@/services/rubric";
import type { GraderItem, GraderState } from "@/utils/grader-state";
import type { GradingTarget } from "./grading-target";
import NewRubricItem from "./NewRubricItem";
import RubricEditor from "./RubricEditor";
import RubricPanel from "./RubricPanel";
import { choose, groupPaths, panelUnits } from "./rubric-panel";

export interface RubricGraderProps {
	target: GradingTarget;
	initial: GraderState;
	/// Where the queue of the exam's questions is.
	queueHref: string;
}

/// The `id` of the `datalist` that suggests group paths.
const GROUP_LIST = "rubric-group-paths";

/// Whether the focus is in a control that takes typed text.
function typesText(element: EventTarget | null): boolean {
	if (!(element instanceof HTMLElement)) return false;
	if (element.isContentEditable) return true;
	if (element instanceof HTMLTextAreaElement) return true;
	if (element instanceof HTMLSelectElement) return true;
	return (
		element instanceof HTMLInputElement &&
		!["checkbox", "radio", "button", "submit"].includes(element.type)
	);
}

/**
 * The grading of one question, one answer at a time, against its rubric.
 *
 * The answers themselves are server markup (`#answer-<publicId>`) that this
 * island shows one at a time. It holds the draft of the answer on screen:
 * items applied, adjustment and comment. Only "Save and next" (or Enter
 * outside a text field) writes, and then it moves to the next pending answer.
 * Creating or changing rubric items writes at once, since the rubric belongs
 * to every answer. The keyboard shortcuts listen on the whole window and stay
 * off while focus is in a text field.
 */
export default function RubricGrader(props: RubricGraderProps): JSX.Element {
	const [state, setState] = createSignal(props.initial);
	const [index, setIndex] = createSignal(0);
	const current = () => state().answers[index()];
	/// Changes only when another answer is on screen, not when the same one is refreshed.
	const currentId = createMemo(() => current()?.submission);

	const seed = current();
	const [keys, setKeys] = createSignal<string[]>(seed?.rubric ?? []);
	const [adjustment, setAdjustment] = createSignal(seed?.adjustment ?? "");
	const [comment, setComment] = createSignal(seed?.comment ?? "");
	const [armed, setArmed] = createSignal<string | null>(null);
	const [editing, setEditing] = createSignal(false);
	const [adding, setAdding] = createSignal(false);
	const [helping, setHelping] = createSignal(false);
	const [finished, setFinished] = createSignal(false);
	const [busy, setBusy] = createSignal(false);
	const [failure, setFailure] = createSignal<string | null>(null);

	const pending = () =>
		state().answers.filter((answer) => answer.state === "pending").length;
	const review = () => state().answers.filter((answer) => answer.review).length;

	/// The retired items the answer applied when it was loaded, which stay on screen.
	const shownRetired = createMemo(() => new Set(current()?.rubric ?? []));
	const units = createMemo(() => panelUnits(state().items, shownRetired()));
	const paths = createMemo(() => groupPaths(state().items));

	/// The score the draft would get, as the server will compute it.
	const score = createMemo(() => {
		const applied = state().items.filter((item) => keys().includes(item.key));
		const extra = adjustment().trim();
		return formatScore(
			scoreValue(
				rubricScore({
					base: state().base,
					items: applied,
					adjustment: isNumberInRange(extra, -1, 1) ? extra : null,
				}),
			) ?? 0,
		);
	});

	// Opening another answer starts its draft from the grade it already has.
	createEffect(
		on(
			currentId,
			() => {
				const answer = untrack(current);
				setKeys(answer?.rubric ?? []);
				setAdjustment(answer?.adjustment ?? "");
				setComment(answer?.comment ?? "");
				setArmed(null);
				setFailure(null);
			},
			{ defer: true },
		),
	);

	// Only the answer on screen is visible in the server markup.
	createEffect(() => {
		const shown = currentId();
		for (const answer of state().answers) {
			document
				.getElementById(`answer-${answer.submission}`)
				?.toggleAttribute("hidden", answer.submission !== shown);
		}
	});

	onMount(() => {
		const hash = window.location.hash.replace(/^#answer-/, "");
		const at = state().answers.findIndex(
			(answer) => answer.submission === hash,
		);
		if (at >= 0) setIndex(at);
		window.addEventListener("keydown", onKeyDown);
		onCleanup(() => window.removeEventListener("keydown", onKeyDown));
	});

	function go(to: number): void {
		const last = state().answers.length - 1;
		if (last < 0) return;
		setIndex(Math.min(Math.max(to, 0), last));
		setFinished(false);
	}

	/// The position of the first pending answer after `from`, wrapping around, or -1.
	function nextPending(from: number): number {
		const answers = state().answers;
		for (let step = 1; step <= answers.length; step++) {
			const at = (from + step) % answers.length;
			if (answers[at]?.state === "pending") return at;
		}
		return -1;
	}

	/// Reads the rubric and answers again, keeping the order of the ones already on screen.
	async function refresh(): Promise<boolean> {
		const { data, error } = await actions.grading.state(props.target);
		if (error) {
			setFailure(errorMessage(error));
			return false;
		}
		const place = new Map(
			state().answers.map((answer, position) => [answer.submission, position]),
		);
		const answers = [...data.answers].sort(
			(a, b) =>
				(place.get(a.submission) ?? Number.MAX_SAFE_INTEGER) -
				(place.get(b.submission) ?? Number.MAX_SAFE_INTEGER),
		);
		setState({ ...data, answers });
		return true;
	}

	async function save(): Promise<void> {
		const answer = current();
		if (!answer || busy()) return;
		setBusy(true);
		setFailure(null);
		const { error } = await actions.grading.gradeRubric({
			discipline: props.target.discipline,
			course: props.target.course,
			exam: props.target.exam,
			submission: answer.submission,
			rubric: keys(),
			adjustment: adjustment().trim() === "" ? undefined : adjustment().trim(),
			comment: comment(),
			ref: answer.ref ?? undefined,
		});
		if (error) {
			setBusy(false);
			setFailure(errorMessage(error));
			return;
		}
		const fresh = await refresh();
		setBusy(false);
		if (!fresh) return;
		const next = nextPending(index());
		if (next < 0) setFinished(true);
		else go(next);
	}

	function pick(key: string): void {
		setKeys(choose(keys(), state().items, key));
		setArmed(null);
	}

	function onCreated(item: GraderItem): void {
		setState({ ...state(), items: [...state().items, item] });
		setKeys(
			choose(
				keys().filter((key) => key !== item.key),
				state().items,
				item.key,
			),
		);
		setAdding(false);
	}

	function onKeyDown(event: KeyboardEvent): void {
		if (
			event.defaultPrevented ||
			event.ctrlKey ||
			event.metaKey ||
			event.altKey
		) {
			return;
		}
		if (event.key === "Escape") {
			setAdding(false);
			setHelping(false);
			setArmed(null);
			return;
		}
		if (typesText(event.target)) return;
		const handled = shortcut(event);
		if (handled) event.preventDefault();
	}

	/// Runs the shortcut `event` asks for and tells whether it was one.
	function shortcut(event: KeyboardEvent): boolean {
		const key = event.key;
		if (editing()) {
			if (key !== "e") return false;
			setEditing(false);
			return true;
		}

		// A letter after a group's digit picks one of its options, even when it is also a command.
		const group = units().find(
			(unit) => unit.kind === "group" && unit.name === armed(),
		);
		if (group?.kind === "group") {
			const leaf = group.leaves.find((entry) => entry.letter === key);
			if (leaf) {
				pick(leaf.item.key);
				return true;
			}
			setArmed(null);
		}

		if (/^[1-9]$/.test(key)) {
			const unit = units().find((entry) => entry.digit === key);
			if (!unit) return false;
			if (unit.kind === "loose") pick(unit.item.key);
			else setArmed(unit.name);
			return true;
		}
		switch (key) {
			case "Enter": {
				const target = event.target as HTMLElement | null;
				if (target?.closest("button, a, summary")) return false;
				void save();
				return true;
			}
			case "e":
				setEditing(true);
				setAdding(false);
				return true;
			case "j":
				go(index() + 1);
				return true;
			case "k":
				go(index() - 1);
				return true;
			case "n":
				setAdding(true);
				return true;
			case "?":
				setHelping(!helping());
				return true;
			default:
				return false;
		}
	}

	return (
		<aside class="flex flex-col gap-4">
			<datalist id={GROUP_LIST}>
				{paths().map((path) => (
					<option value={path} />
				))}
			</datalist>

			<section
				aria-label={m.grades_grader_progress()}
				class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
			>
				<Show when={current()}>
					<span class="font-semibold">
						{m.grades_grader_answer_of({
							index: index() + 1,
							total: state().answers.length,
						})}
					</span>
					<Show when={current()?.review}>
						<span class="badge badge-warning badge-sm">
							{m.grades_grader_to_review()}
						</span>
					</Show>
				</Show>
				<span>{m.grades_queue_pending({ count: pending() })}</span>
				<span>{m.grades_queue_review({ count: review() })}</span>
			</section>

			<Show
				when={!finished()}
				fallback={
					<section class="rounded-box border border-base-300 p-4">
						<h3 class="font-semibold">{m.grades_queue_done()}</h3>
						<div class="mt-3 flex gap-2">
							<a href={props.queueHref} class="btn btn-primary btn-sm">
								{m.grades_grader_done_back()}
							</a>
							<button
								type="button"
								class="btn btn-ghost btn-sm"
								onClick={() => setFinished(false)}
							>
								{m.grades_grader_keep_reviewing()}
							</button>
						</div>
					</section>
				}
			>
				<section
					aria-label={m.grades_grader_rubric()}
					class="rounded-box border border-base-300 bg-base-100 p-3"
				>
					<div class="mb-2 flex items-center justify-between gap-2">
						<h3 class="font-semibold">{m.grades_grader_rubric()}</h3>
						<div class="flex gap-1">
							<button
								type="button"
								class="btn btn-ghost btn-xs"
								aria-pressed={helping()}
								onClick={() => setHelping(!helping())}
							>
								{m.grades_grader_help()}
							</button>
							<button
								type="button"
								class="btn btn-outline btn-xs"
								onClick={() => {
									setEditing(!editing());
									setAdding(false);
								}}
							>
								{editing()
									? m.grades_grader_done_editing()
									: m.grades_grader_edit()}
							</button>
						</div>
					</div>

					<Show when={helping()}>
						<ul class="mb-3 list-disc pl-5 text-xs text-muted">
							<li>{m.grades_grader_help_digit()}</li>
							<li>{m.grades_grader_help_letter()}</li>
							<li>{m.grades_grader_help_enter()}</li>
							<li>{m.grades_grader_help_move()}</li>
							<li>{m.grades_grader_help_new()}</li>
							<li>{m.grades_grader_help_edit()}</li>
						</ul>
					</Show>

					<Show
						when={editing()}
						fallback={
							<RubricPanel
								units={units()}
								applied={keys()}
								armed={armed()}
								onChoose={pick}
							/>
						}
					>
						<RubricEditor
							target={props.target}
							base={state().base}
							items={state().items.filter((item) => !item.retired)}
							groupList={GROUP_LIST}
							onChanged={async () => {
								await refresh();
							}}
						/>
					</Show>

					<Show when={adding()}>
						<NewRubricItem
							target={props.target}
							groupList={GROUP_LIST}
							onCreated={onCreated}
						/>
					</Show>
				</section>

				<Show when={current()}>
					<div class="flex flex-col gap-3">
						<label class="flex flex-col gap-1 text-sm">
							<span class="font-medium">{m.grades_grader_adjustment()}</span>
							<input
								type="text"
								inputmode="decimal"
								class="input input-sm w-28"
								autocomplete="off"
								placeholder="0.05"
								value={adjustment()}
								onInput={(event) => setAdjustment(event.currentTarget.value)}
							/>
						</label>
						<label class="flex flex-col gap-1 text-sm">
							<span class="font-medium">{m.grades_grader_comment()}</span>
							<textarea
								class="textarea w-full"
								rows="3"
								value={comment()}
								onInput={(event) => setComment(event.currentTarget.value)}
							/>
						</label>
						<p class="flex items-baseline gap-2">
							<span class="text-sm font-medium">{m.grades_grader_score()}</span>
							<span
								role="status"
								aria-label={m.grades_grader_score()}
								class="text-2xl font-bold"
							>
								{score()}
							</span>
						</p>
						<FormAlert error={failure() ?? undefined} />
						<button
							type="button"
							class="btn btn-primary"
							disabled={busy()}
							onClick={() => void save()}
						>
							{m.grades_grader_save_next()}
						</button>
					</div>
				</Show>
			</Show>
		</aside>
	);
}
