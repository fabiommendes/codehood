import { createSignal, For, type JSX, Show } from "solid-js";
import QuestionPreview from "@/components/question/QuestionPreview";
import type { QuestionPublic } from "@/db";
import { m } from "@/i18n";
import type { QuestionDocument } from "@/mdq";
import { examQuestionAttachmentUrl } from "@/urls";
import type { PretestSource } from "@/utils/pretest-sources";
import { AnswerField, codeLanguageOf } from "./AnswerField";
import type { AnswerPayload } from "./answer-payload";
import { pointsOf, QuestionFrame } from "./QuestionFrame";

/// One pinned question: the public form a student gets, and the full document for the key.
export interface PreviewQuestion {
	slug: string;
	question: QuestionPublic["question"];
	key: QuestionDocument;
}

export interface ExamPreviewProps {
	/// The exam's questions in exam order.
	questions: PreviewQuestion[];
	/// The sources the browser runs as pretests of each code question, by question slug.
	pretests?: Record<string, PretestSource[]>;
	/// The highlighted HTML of each code question's example tests, by question slug.
	exampleHtml?: Record<string, string[]>;
	/// Whether students may run code in this exam (`canRunCode`).
	codeRun?: boolean;
	/// Origin of the runner iframe; null when the server has none.
	runnerOrigin?: string | null;
	/// `<discipline>/<course>` and the exam slug, which the attachment downloads hang off.
	course: string;
	exam: string;
}

type Tab = "student" | "key";

const TABS: { id: Tab; label: () => string }[] = [
	{ id: "student", label: m.exams_tab_student_view },
	{ id: "key", label: m.exams_tab_correct_answer },
];

/**
 * An exam's questions as the instructor checks them: the same frame and
 * answer fields a student gets in the attempt, or the answer key.
 *
 * Answers stay in this page: nothing is saved, sent or kept as a draft.
 */
export default function ExamPreview(props: ExamPreviewProps): JSX.Element {
	const [tab, setTab] = createSignal<Tab>("student");
	const [answers, setAnswers] = createSignal<Record<string, AnswerPayload>>({});
	const points = () => pointsOf(props.questions);

	return (
		<div class="flex flex-col gap-6">
			<div role="tablist" class="tabs tabs-box w-fit">
				<For each={TABS}>
					{(entry) => (
						<button
							type="button"
							role="tab"
							class={`tab ${tab() === entry.id ? "tab-active" : ""}`}
							aria-selected={tab() === entry.id}
							onClick={() => setTab(entry.id)}
						>
							{entry.label()}
						</button>
					)}
				</For>
			</div>

			<For each={props.questions}>
				{(entry, index) => (
					<QuestionFrame
						number={index() + 1}
						title={entry.question.title}
						tone="text-base-content"
						points={points()[index()] ?? null}
					>
						{/* Hidden rather than unmounted, so switching tabs keeps what was typed. */}
						<div class={tab() === "student" ? "contents" : "hidden"}>
							<AnswerField
								question={entry.question}
								payload={answers()[entry.slug]}
								readonly={false}
								onChange={(payload) =>
									setAnswers((all) => ({ ...all, [entry.slug]: payload }))
								}
								pretests={props.pretests?.[entry.slug]}
								exampleHtml={props.exampleHtml?.[entry.slug]}
								runnerOrigin={props.runnerOrigin ?? null}
								attachmentUrl={attachmentUrl(entry)}
								code={codeContext(entry)}
							/>
						</div>
						<Show when={tab() === "key"}>
							<QuestionPreview
								data={entry.key}
								tab={() => "key"}
								attachmentUrls={attachmentUrls(entry)}
							/>
						</Show>
					</QuestionFrame>
				)}
			</For>
		</div>
	);

	/// The download URL of each attachment of the version of a question the exam pins.
	function attachmentUrl(entry: PreviewQuestion) {
		return (name: string) =>
			examQuestionAttachmentUrl(props.course, props.exam, entry.slug, name);
	}

	function attachmentUrls(entry: PreviewQuestion) {
		return Object.fromEntries(
			(entry.question.attachments ?? []).map(({ name }) => [
				name,
				attachmentUrl(entry)(name),
			]),
		);
	}

	/// The code editor context of an essay answered with code, with a save that never happens.
	function codeContext(entry: PreviewQuestion) {
		const language = codeLanguageOf(entry.question);
		if (language === null) return undefined;
		return {
			language,
			codeRun: props.codeRun ?? false,
			runnerOrigin: props.runnerOrigin ?? null,
			draft: { username: "", course: "", exam: "", question: entry.slug },
			keepDraft: false,
			value: "",
			valueSavedAt: null,
			clockOffsetMs: 0,
			save: { state: "saved" as const, savedAt: null, failingSince: null },
			onConflict: () => {},
		};
	}
}
