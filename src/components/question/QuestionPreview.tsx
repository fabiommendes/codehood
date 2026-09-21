import {
	type Accessor,
	createMemo,
	createSignal,
	type JSX,
	Match,
	Show,
	Switch,
} from "solid-js";
import { Question } from "@/mdq/question";
import type * as schema from "@/mdq/schemas-generated";
import type { QuestionResult } from "@/mdq/scoring";
import EssayView from "./EssayView";
import FillInView from "./FillInView";
import { ResetIcon, SubmitIcon } from "./icons";
import MultipleChoiceView from "./MultipleChoiceView";
import MultipleSelectionView from "./MultipleSelectionView";
import NumericView from "./NumericView";
import ShortAnswerView from "./ShortAnswerView";
import TrueFalseView from "./TrueFalseView";

export interface QuestionPreviewProps {
	/** The full authored document, answer key included. */
	data: schema.Question;
	/**
	 * Drives the tab from outside instead of this component's own signal, and
	 * hides its tab bar — for a caller like `ExamQuestionsList` that puts one
	 * shared toggle above several previews rather than one per question.
	 * Omit it to keep the standalone behavior (own signal, own tab bar).
	 */
	tab?: Accessor<PreviewTab>;
}

/** Which of the two ways an instructor can look at the question is on screen. */
export type PreviewTab = "student" | "key";

const TABS: { id: PreviewTab; label: string }[] = [
	{ id: "student", label: "Student view" },
	{ id: "key", label: "Correct answer" },
];

/**
 * Lets an instructor look at a question two ways: as a student would see and
 * answer it, or with its keyed answer revealed.
 *
 * The student tab is interactive — the instructor can answer the question
 * and have it scored on the spot with `Question#score()` — and the key tab
 * runs `answerKey()` back through the same `score()`, so the score it shows
 * is a real one rather than a fabricated 1.00. Every type dispatches to its
 * own `*View` component in the appropriate mode; this never invents a fourth
 * rendering path, it only decides what value and result to feed the existing
 * `answer` / `review` modes with.
 */
export default function QuestionPreview(
	props: QuestionPreviewProps,
): JSX.Element {
	const question = createMemo(() => new Question(props.data));
	const [internalTab, setInternalTab] = createSignal<PreviewTab>("student");
	const tab = () => (props.tab ? props.tab() : internalTab());

	return (
		<div class="flex flex-col gap-6">
			<Show when={!props.tab}>
				<div role="tablist" class="tabs tabs-box w-fit">
					{TABS.map((entry) => (
						<button
							type="button"
							role="tab"
							class={`tab ${tab() === entry.id ? "tab-active" : ""}`}
							aria-selected={tab() === entry.id}
							onClick={() => setInternalTab(entry.id)}
						>
							{entry.label}
						</button>
					))}
				</div>
			</Show>

			<Switch
				fallback={
					<p class="text-sm text-base-content/60">
						Preview for "{question().type}" questions is not implemented yet.
					</p>
				}
			>
				<Match when={question().type === "essay"}>
					<EssayPreview
						question={question() as Question<schema.Essay>}
						tab={tab}
					/>
				</Match>
				<Match when={question().type === "numeric"}>
					<NumericPreview
						question={question() as Question<schema.Numeric>}
						tab={tab}
					/>
				</Match>
				<Match when={question().type === "short-answer"}>
					<ShortAnswerPreview
						question={question() as Question<schema.ShortAnswer>}
						tab={tab}
					/>
				</Match>
				<Match when={question().type === "multiple-choice"}>
					<MultipleChoicePreview
						question={question() as Question<schema.MultipleChoice>}
						tab={tab}
					/>
				</Match>
				<Match when={question().type === "multiple-selection"}>
					<MultipleSelectionPreview
						question={question() as Question<schema.MultipleSelection>}
						tab={tab}
					/>
				</Match>
				<Match when={question().type === "true-false"}>
					<TrueFalsePreview
						question={question() as Question<schema.TrueFalse>}
						tab={tab}
					/>
				</Match>
				<Match when={question().type === "fill-in"}>
					<FillInPreview
						question={question() as Question<schema.FillIn>}
						tab={tab}
					/>
				</Match>
			</Switch>
		</div>
	);
}

interface SimulateControlsProps {
	disabled: boolean;
	checked: boolean;
	onCheck: () => void;
	onReset: () => void;
}

/**
 * The submit/reset pair the student tab drives its scoring with, styled as a
 * floating action button in the card's bottom-right corner — the same shape
 * the real exam-taking view will submit an answer with, so the instructor's
 * "student view" simulation reads like the real thing rather than an
 * authoring tool's "check answer" affordance.
 */
function SimulateControls(props: SimulateControlsProps): JSX.Element {
	return (
		<div class="flex justify-end">
			<Show
				when={!props.checked}
				fallback={
					<button
						type="button"
						class="btn btn-circle btn-lg"
						aria-label="Reset"
						title="Reset"
						onClick={props.onReset}
					>
						<ResetIcon />
					</button>
				}
			>
				<button
					type="button"
					class="btn btn-circle btn-lg btn-primary"
					aria-label="Submit"
					title="Submit"
					disabled={props.disabled}
					onClick={props.onCheck}
				>
					<SubmitIcon />
				</button>
			</Show>
		</div>
	);
}

interface TypePreviewProps<Q extends schema.Question> {
	question: Question<Q>;
	tab: Accessor<PreviewTab>;
}

function EssayPreview(props: TypePreviewProps<schema.Essay>): JSX.Element {
	const publicQ = createMemo(() => props.question.toPublic());
	const key = createMemo(() => props.question.answerKey());
	const keyResult = createMemo<QuestionResult<"essay">>(() => ({
		...props.question.score({ essay: key() }),
		correct: key(),
	}));

	const [value, setValue] = createSignal("");
	const [result, setResult] = createSignal<QuestionResult<"essay">>();

	function check(): void {
		setResult({ ...props.question.score({ essay: value() }), correct: key() });
	}
	function reset(): void {
		setValue("");
		setResult(undefined);
	}

	return (
		<Switch>
			<Match when={props.tab() === "student"}>
				<div class="flex flex-col gap-3">
					<EssayView
						question={publicQ()}
						mode={result() ? "review" : "answer"}
						value={value()}
						onChange={setValue}
						result={result()}
					/>
					<SimulateControls
						disabled={value().trim() === ""}
						checked={result() !== undefined}
						onCheck={check}
						onReset={reset}
					/>
				</div>
			</Match>
			<Match when={props.tab() === "key"}>
				<EssayView
					question={publicQ()}
					mode="review"
					value={key()}
					result={keyResult()}
				/>
			</Match>
		</Switch>
	);
}

function NumericPreview(props: TypePreviewProps<schema.Numeric>): JSX.Element {
	const publicQ = createMemo(() => props.question.toPublic());
	const key = createMemo(() => props.question.answerKey());
	const keyResult = createMemo<QuestionResult<"numeric">>(() => ({
		...props.question.score({ value: key() }),
		correct: key(),
	}));

	const [value, setValue] = createSignal<number | null>(null);
	const [result, setResult] = createSignal<QuestionResult<"numeric">>();

	function check(): void {
		setResult({ ...props.question.score({ value: value() }), correct: key() });
	}
	function reset(): void {
		setValue(null);
		setResult(undefined);
	}

	return (
		<Switch>
			<Match when={props.tab() === "student"}>
				<div class="flex flex-col gap-3">
					<NumericView
						question={publicQ()}
						mode={result() ? "review" : "answer"}
						value={value()}
						onChange={setValue}
						result={result()}
					/>
					<SimulateControls
						disabled={value() === null}
						checked={result() !== undefined}
						onCheck={check}
						onReset={reset}
					/>
				</div>
			</Match>
			<Match when={props.tab() === "key"}>
				<NumericView
					question={publicQ()}
					mode="review"
					value={key()}
					result={keyResult()}
				/>
			</Match>
		</Switch>
	);
}

function ShortAnswerPreview(
	props: TypePreviewProps<schema.ShortAnswer>,
): JSX.Element {
	const publicQ = createMemo(() => props.question.toPublic());
	const key = createMemo(() => props.question.answerKey());
	// The key's first literal spelling, or "" when it has none — a regex-only
	// question has nothing a text box can be seeded with.
	const keyValue = createMemo(() => key()[0] ?? "");
	const keyResult = createMemo<QuestionResult<"short-answer">>(() => ({
		...props.question.score({ text: keyValue() }),
		correct: key(),
	}));

	const [value, setValue] = createSignal("");
	const [result, setResult] = createSignal<QuestionResult<"short-answer">>();

	function check(): void {
		setResult({ ...props.question.score({ text: value() }), correct: key() });
	}
	function reset(): void {
		setValue("");
		setResult(undefined);
	}

	return (
		<Switch>
			<Match when={props.tab() === "student"}>
				<div class="flex flex-col gap-3">
					<ShortAnswerView
						question={publicQ()}
						mode={result() ? "review" : "answer"}
						value={value()}
						onChange={setValue}
						result={result()}
					/>
					<SimulateControls
						disabled={value().trim() === ""}
						checked={result() !== undefined}
						onCheck={check}
						onReset={reset}
					/>
				</div>
			</Match>
			<Match when={props.tab() === "key"}>
				<ShortAnswerView
					question={publicQ()}
					mode="review"
					value={keyValue()}
					result={keyResult()}
				/>
			</Match>
		</Switch>
	);
}

function MultipleChoicePreview(
	props: TypePreviewProps<schema.MultipleChoice>,
): JSX.Element {
	const publicQ = createMemo(() => props.question.toPublic());
	const key = createMemo(() => props.question.answerKey());
	// A tied-best choice, when there is one — a question with no choice worth
	// anything has no answer to seed the key tab with.
	const keyChoice = createMemo(() => key()[0]);
	const keyResult = createMemo<QuestionResult<"multiple-choice">>(() => {
		const choice = keyChoice();
		return choice === undefined
			? { score: 0, correct: key() }
			: { ...props.question.score({ choice }), correct: key() };
	});

	const [value, setValue] = createSignal<string | null>(null);
	const [result, setResult] = createSignal<QuestionResult<"multiple-choice">>();

	function check(): void {
		const choice = value();
		if (choice === null) return;
		setResult({ ...props.question.score({ choice }), correct: key() });
	}
	function reset(): void {
		setValue(null);
		setResult(undefined);
	}

	return (
		<Switch>
			<Match when={props.tab() === "student"}>
				<div class="flex flex-col gap-3">
					<MultipleChoiceView
						question={publicQ()}
						mode={result() ? "review" : "answer"}
						value={value()}
						onChange={setValue}
						result={result()}
					/>
					<SimulateControls
						disabled={value() === null}
						checked={result() !== undefined}
						onCheck={check}
						onReset={reset}
					/>
				</div>
			</Match>
			<Match when={props.tab() === "key"}>
				<MultipleChoiceView
					question={publicQ()}
					mode="review"
					value={keyChoice() ?? null}
					result={keyResult()}
				/>
			</Match>
		</Switch>
	);
}

function MultipleSelectionPreview(
	props: TypePreviewProps<schema.MultipleSelection>,
): JSX.Element {
	const publicQ = createMemo(() => props.question.toPublic());
	const key = createMemo(() => props.question.answerKey());
	const keyResult = createMemo<QuestionResult<"multiple-selection">>(() => ({
		...props.question.score({ choices: key() }),
		correct: key(),
	}));

	const [value, setValue] = createSignal<ReadonlySet<string>>(new Set());
	const [result, setResult] =
		createSignal<QuestionResult<"multiple-selection">>();

	function check(): void {
		setResult({
			...props.question.score({ choices: new Set(value()) }),
			correct: key(),
		});
	}
	function reset(): void {
		setValue(new Set<string>());
		setResult(undefined);
	}

	return (
		<Switch>
			<Match when={props.tab() === "student"}>
				<div class="flex flex-col gap-3">
					<MultipleSelectionView
						question={publicQ()}
						mode={result() ? "review" : "answer"}
						value={value()}
						onChange={setValue}
						result={result()}
					/>
					<SimulateControls
						disabled={value().size === 0}
						checked={result() !== undefined}
						onCheck={check}
						onReset={reset}
					/>
				</div>
			</Match>
			<Match when={props.tab() === "key"}>
				<MultipleSelectionView
					question={publicQ()}
					mode="review"
					value={key()}
					result={keyResult()}
				/>
			</Match>
		</Switch>
	);
}

function TrueFalsePreview(
	props: TypePreviewProps<schema.TrueFalse>,
): JSX.Element {
	const publicQ = createMemo(() => props.question.toPublic());
	const key = createMemo(() => props.question.answerKey());
	const keyResult = createMemo<QuestionResult<"true-false">>(() => ({
		...props.question.score({ answers: key() }),
		correct: key(),
	}));

	const [value, setValue] = createSignal<ReadonlyMap<string, boolean>>(
		new Map(),
	);
	const [result, setResult] = createSignal<QuestionResult<"true-false">>();

	function check(): void {
		setResult({
			...props.question.score({ answers: new Map(value()) }),
			correct: key(),
		});
	}
	function reset(): void {
		setValue(new Map());
		setResult(undefined);
	}

	return (
		<Switch>
			<Match when={props.tab() === "student"}>
				<div class="flex flex-col gap-3">
					<TrueFalseView
						question={publicQ()}
						mode={result() ? "review" : "answer"}
						value={value()}
						onChange={setValue}
						result={result()}
					/>
					<SimulateControls
						disabled={value().size === 0}
						checked={result() !== undefined}
						onCheck={check}
						onReset={reset}
					/>
				</div>
			</Match>
			<Match when={props.tab() === "key"}>
				<TrueFalseView
					question={publicQ()}
					mode="review"
					value={key()}
					result={keyResult()}
				/>
			</Match>
		</Switch>
	);
}

function FillInPreview(props: TypePreviewProps<schema.FillIn>): JSX.Element {
	const publicQ = createMemo(() => props.question.toPublic());
	const key = createMemo(() => props.question.answerKey());
	// One accepted spelling per blank, so the key tab has something to fill
	// every blank with — a blank whose key is a regex-only list stays empty.
	const keyValue = createMemo<Record<string, string>>(() =>
		Object.fromEntries(
			Object.entries(key()).map(([id, spellings]) => [id, spellings[0] ?? ""]),
		),
	);
	const keyResult = createMemo<QuestionResult<"fill-in">>(() => ({
		...props.question.score({ blanks: keyValue() }),
		correct: key(),
	}));

	const [value, setValue] = createSignal<Record<string, string>>({});
	const [result, setResult] = createSignal<QuestionResult<"fill-in">>();

	function check(): void {
		setResult({
			...props.question.score({ blanks: value() }),
			correct: key(),
		});
	}
	function reset(): void {
		setValue({});
		setResult(undefined);
	}

	return (
		<Switch>
			<Match when={props.tab() === "student"}>
				<div class="flex flex-col gap-3">
					<FillInView
						question={publicQ()}
						mode={result() ? "review" : "answer"}
						value={value()}
						onChange={setValue}
						result={result()}
					/>
					<SimulateControls
						disabled={Object.values(value()).every((v) => v.trim() === "")}
						checked={result() !== undefined}
						onCheck={check}
						onReset={reset}
					/>
				</div>
			</Match>
			<Match when={props.tab() === "key"}>
				<FillInView
					question={publicQ()}
					mode="review"
					value={keyValue()}
					result={keyResult()}
				/>
			</Match>
		</Switch>
	);
}
