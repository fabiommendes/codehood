import { Markdown } from "mdq/solid";
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
import { CodeAnswer } from "@/components/exam/CodeAnswer";
import { m } from "@/i18n";
import {
	correctResponses,
	NotAutoGradable,
	type PublicCodeQuestion,
	publicForm,
	type QuestionDocument,
	ResponseError,
	scoreBlanks,
	scoreResponse,
} from "@/mdq";
import { pretestSources } from "@/utils/pretest-sources";
import { AttachmentList, type AttachmentListProps } from "./AttachmentList";
import { ResetIcon, SubmitIcon } from "./icons";
import { AnyQuestionView, type AnyQuestionViewProps, mdqMessages } from "./mdq";

export interface QuestionPreviewProps {
	/** The full authored document, answer key included. */
	data: QuestionDocument;
	/**
	 * Drives the tab from outside instead of this component's own signal, and
	 * hides its tab bar, for a caller like `ExamPreview` or `AnswerKey` that
	 * shows only one of the tabs.
	 * Omit it to keep the standalone behavior (own signal, own tab bar).
	 */
	tab?: Accessor<PreviewTab>;
	/** Leaves the score badge out of the key tab, where it only restates that the key is right. */
	hideScore?: boolean;
	/** Origin of the runner iframe the pretests of a code question run in; null when the server has none. */
	runnerOrigin?: string | null;
	/** The highlighted HTML of the example tests of a code question, from `highlightExamples`. */
	exampleHtml?: readonly string[];
	/** The highlighted HTML of the model answer of a code question, from `highlightCode`. Trusted: never user HTML. */
	keyHtml?: string;
	/** The download URL of each attachment of the question by name, which an island can take as a prop; a name without one has no download link. */
	attachmentUrls?: Readonly<Record<string, string>>;
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
				runnerOrigin={props.runnerOrigin ?? null}
				exampleHtml={props.exampleHtml}
				keyHtml={props.keyHtml}
				attachmentUrl={(name) => props.attachmentUrls?.[name] ?? null}
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
	runnerOrigin: string | null;
	exampleHtml?: readonly string[];
	keyHtml?: string;
	attachmentUrl: AttachmentListProps["url"];
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
	// Only a runner report scores a code response, and a preview has none.
	if (question.type === "code") return { pending: true, correct };
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
	const publicQ = createMemo(() => publicForm(props.question));
	const pretests = createMemo(() =>
		props.question.type === "code" ? pretestSources(props.question) : [],
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
			<Match when={props.tab() === "student" && publicQ().type === "code"}>
				<CodeAnswer
					question={publicQ() as PublicCodeQuestion}
					pretests={pretests()}
					runnerOrigin={props.runnerOrigin}
					exampleHtml={props.exampleHtml}
					value={null}
					onChange={() => {}}
					attachments={publicQ().attachments}
					attachmentUrl={props.attachmentUrl}
				/>
			</Match>
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
					<AttachmentList
						attachments={publicQ().attachments}
						url={props.attachmentUrl}
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
			<Match when={props.tab() === "key" && publicQ().type === "code"}>
				<div class="flex flex-col gap-4" data-code-key>
					<div class="mdq-stem">
						<Markdown text={(publicQ() as PublicCodeQuestion).stem} />
					</div>
					<AttachmentList
						attachments={publicQ().attachments}
						url={props.attachmentUrl}
					/>
					<Show when={props.keyHtml}>
						{(html) => (
							<div>
								<p class="text-sm font-semibold text-muted">
									{m.grades_code_model_answer()}
								</p>
								<div
									class="mt-2 overflow-x-auto rounded-box bg-base-200 p-4 text-sm text-base-content [&_.shiki]:!m-0 [&_.shiki]:!bg-transparent [&_.shiki_span]:!bg-transparent"
									data-model-answer
									innerHTML={html()}
								/>
							</div>
						)}
					</Show>
				</div>
			</Match>
			<Match when={props.tab() === "key"}>
				<div class="flex flex-col gap-3">
					<AnyQuestionView
						question={publicQ()}
						mode="review"
						hideScore={props.hideScore}
						value={key()}
						result={keyResult()}
						messages={mdqMessages}
					/>
					<AttachmentList
						attachments={publicQ().attachments}
						url={props.attachmentUrl}
					/>
				</div>
			</Match>
		</Switch>
	);
}
