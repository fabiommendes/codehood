import { createSignal, For, type JSX } from "solid-js";
import type { PreviewTab } from "@/components/question/QuestionPreview";
import type { Question } from "@/db";
import { m } from "@/i18n";
import ExamQuestion from "./ExamQuestion";

/// A pinned question as this island renders it, answer key included, minus
/// the raw database id, which never reaches the browser.
export type ExamQuestionRow = Omit<Question, "id">;

export interface ExamQuestionsListProps {
	questions: ExamQuestionRow[];
}

const TABS: { id: PreviewTab; label: string }[] = [
	{ id: "student", label: m.exams_tab_student_view() },
	{ id: "key", label: m.exams_tab_correct_answer() },
];

/**
 * An exam's pinned questions as staff see them, inlined one after another.
 *
 * Holds which of `QuestionPreview`'s two tabs is on screen and hands it down
 * to every question, so a single control switches all of them together
 * instead of each question carrying its own toggle. Students see the
 * questions through `ExamAttempt` instead.
 */
export default function ExamQuestionsList(
	props: ExamQuestionsListProps,
): JSX.Element {
	const [tab, setTab] = createSignal<PreviewTab>("student");

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
							{entry.label}
						</button>
					)}
				</For>
			</div>

			<For each={props.questions}>
				{(question) => (
					<div class="card card-border overflow-hidden bg-base-100/50">
						<div class="card-body">
							<ExamQuestion question={question} tab={tab} />
						</div>
					</div>
				)}
			</For>
		</div>
	);
}
