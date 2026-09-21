import { createSignal, For, type JSX, Show } from "solid-js";
import type { PreviewTab } from "@/components/question/QuestionPreview";
import type { Question, QuestionPublic } from "@/db";
import ExamQuestion from "./ExamQuestion";

export interface ExamQuestionsListProps {
	questions: (Question | QuestionPublic)[];
	/** Whoever may write the course's contents also sees the answer key. */
	canManage: boolean;
}

const TABS: { id: PreviewTab; label: string }[] = [
	{ id: "student", label: "Student view" },
	{ id: "key", label: "Correct answer" },
];

/**
 * An exam's pinned questions, inlined one after another.
 *
 * This is the one piece of client state the exam page needs: which of
 * `QuestionPreview`'s two tabs is on screen, held here and handed down to
 * every question so a single control switches all of them together, instead
 * of each question carrying its own toggle. A student has no such toggle —
 * their questions are always the frozen `readonly` view `ExamQuestion`
 * already renders for them — so this island stays fully server-renderable
 * markup for that case, and only the instructor branch has anything to
 * click.
 */
export default function ExamQuestionsList(
	props: ExamQuestionsListProps,
): JSX.Element {
	const [tab, setTab] = createSignal<PreviewTab>("student");

	return (
		<div class="flex flex-col gap-6">
			<Show when={props.canManage}>
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
			</Show>

			<For each={props.questions}>
				{(question) => (
					<div class="card card-border overflow-hidden bg-base-100/50 shadow-md">
						<div class="stripe-brand h-1.5" />
						<div class="card-body">
							<ExamQuestion
								question={question}
								canManage={props.canManage}
								tab={tab}
							/>
						</div>
					</div>
				)}
			</For>
		</div>
	);
}
