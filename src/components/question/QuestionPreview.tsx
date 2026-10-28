import {
	type Accessor,
	createMemo,
	createSignal,
	type JSX,
	Match,
	Show,
	Switch,
} from "solid-js";
import { isAnswered } from "@/components/exam/answer-payload";
import { m } from "@/i18n";
import {
	correctResponses,
	NotAutoGradable,
	type PublicQuestion,
	publicForm,
	type QuestionDocument,
	ResponseError,
	scoreBlanks,
	scoreResponse,
} from "@/mdq";
import { ResetIcon, SubmitIcon } from "./icons";
import { AnyQuestionView, type AnyQuestionViewProps, mdqMessages } from "./mdq";

export interface QuestionPreviewProps {
	/** The full authored document, answer key included. */
	data: QuestionDocument;
	/**
	 * Drives the tab from outside instead of this component's own signal, and
	 * hides its tab bar — for a caller like `ExamQuestionsList` that puts one
	 * shared toggle above several previews rather than one per question.
	 * Omit it to keep the standalone behavior (own signal, own tab bar).
	 */
	tab?: Accessor<PreviewTab>;
	/** Leaves the score badge out of the key tab, where it only restates that the key is right. */
	hideScore?: boolean;
}

/** Which of the two ways an instructor can look at the question is on screen. */
export type PreviewTab = "student" | "key";

const TABS: { id: PreviewTab; label: () => string }[] = [
	{ id: "student", label: m.questions_tab_student_view },
	{ id: "key", label: m.questions_tab_correct_answer },
];

/**
 * Lets an instructor look at a question two ways: as a student would see and
 * answer it, or with its keyed answer revealed.
 *
 * The student tab is interactive — the instructor can answer the question
 * and have it scored on the spot with `scoreResponse` — and the key tab runs
 * the first correct response back through the same function, so the score it
 * shows is a real one rather than a fabricated 1.00. Both tabs render the
 * question's own view; this only decides what value and result to feed its
 * `answer` and `review` modes with.
 */
export default function QuestionPreview(
	props: QuestionPreviewProps,
): JSX.Element {
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
							{entry.label()}
						</button>
					))}
				</div>
			</Show>

			<TypePreview
				question={props.data}
				tab={tab}
				hideScore={props.hideScore}
			/>
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
						aria-label={m.questions_reset()}
						title={m.questions_reset()}
						onClick={props.onReset}
					>
						<ResetIcon />
					</button>
				}
			>
				<button
					type="button"
					class="btn btn-circle btn-lg btn-primary"
					aria-label={m.questions_submit()}
					title={m.questions_submit()}
					disabled={props.disabled}
					onClick={props.onCheck}
				>
					<SubmitIcon />
				</button>
			</Show>
		</div>
	);
}

interface TypePreviewProps {
	question: QuestionDocument;
	tab: Accessor<PreviewTab>;
	hideScore?: boolean;
}

/// What the review mode of a view takes as `result`.
type PreviewResult = NonNullable<AnyQuestionViewProps["result"]>;

/**
 * The first correct response of `question`, to seed the key tab with, or
 * `null` when it has none.
 *
 * A fill-in question lists the correct responses per blank, so its key is one
 * correct response for each blank.
 */
function keyResponse(question: QuestionDocument): unknown {
	const correct = correctResponses(question);
	if (!Array.isArray(correct)) {
		return Object.fromEntries(
			Object.entries(correct).flatMap(([id, responses]) =>
				responses.length > 0 ? [[id, responses[0]]] : [],
			),
		);
	}
	return correct[0] ?? null;
}

/**
 * The result of `response` as a view shows it: its score and feedback, or
 * pending when only an instructor can grade it.
 *
 * The correct responses go along, so the view can mark the answer key.
 */
function previewResult(
	question: QuestionDocument,
	response: unknown,
): PreviewResult {
	const correct = correctResponses(question) as PreviewResult["correct"];
	try {
		return { ...scoreResponse(question, response), correct };
	} catch (error) {
		if (error instanceof NotAutoGradable) {
			// A fill-in still marks the blanks that need no instructor.
			const blanks =
				question.type === "fill-in"
					? scoreBlanks(question, response)
					: undefined;
			return { pending: true, blanks, correct };
		}
		if (error instanceof ResponseError) {
			return { score: 0, feedback: [], correct };
		}
		throw error;
	}
}

function TypePreview(props: TypePreviewProps): JSX.Element {
	const publicQ = createMemo(
		() => publicForm(props.question) as PublicQuestion,
	);
	const key = createMemo(() => keyResponse(props.question));
	const keyResult = createMemo(() => previewResult(props.question, key()));

	const [value, setValue] = createSignal<unknown>(null);
	const [result, setResult] = createSignal<PreviewResult>();

	function check(): void {
		setResult(previewResult(props.question, value()));
	}
	function reset(): void {
		setValue(null);
		setResult(undefined);
	}

	return (
		<Switch>
			<Match when={props.tab() === "student"}>
				<div class="flex flex-col gap-3">
					<AnyQuestionView
						question={publicQ()}
						mode={result() ? "review" : "answer"}
						value={value()}
						onChange={setValue}
						result={result()}
						messages={mdqMessages}
					/>
					<SimulateControls
						disabled={
							!isAnswered(
								props.question.type,
								value() as Parameters<typeof isAnswered>[1],
							)
						}
						checked={result() !== undefined}
						onCheck={check}
						onReset={reset}
					/>
				</div>
			</Match>
			<Match when={props.tab() === "key"}>
				<AnyQuestionView
					question={publicQ()}
					mode="review"
					hideScore={props.hideScore}
					value={key()}
					result={keyResult()}
					messages={mdqMessages}
				/>
			</Match>
		</Switch>
	);
}
