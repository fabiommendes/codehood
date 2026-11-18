import { createSignal, createUniqueId, type JSX } from "solid-js";
import { QuestionFrame } from "@/components/exam/QuestionFrame";
import { pointsByPosition } from "@/components/exam/question-points";
import { withViewTransition } from "@/utils/view-transition";
import QuestionPreview, {
	PREVIEW_TABS,
	type PreviewTab,
	type QuestionPreviewProps,
} from "./QuestionPreview";

/// The question stands alone, so it carries the whole exam as the first of one.
const [WHOLE] = pointsByPosition([{ weight: 1 }]);

/**
 * A question outside any exam, drawn as the first question of an attempt: the
 * frame of the exam page around the student view or the answer key.
 *
 * Nothing is saved, so the fields only answer locally.
 */
export default function QuestionPage(props: QuestionPreviewProps): JSX.Element {
	const [tab, setTab] = createSignal<PreviewTab>("student");
	/// Names the active tab for the view transition that slides it.
	const tabsId = createUniqueId();

	return (
		<div class="flex flex-col gap-6">
			<div role="tablist" class="tabs tabs-box w-fit">
				{PREVIEW_TABS.map((entry) => (
					<button
						type="button"
						role="tab"
						class={`tab ${tab() === entry.id ? "tab-active" : ""}`}
						aria-selected={tab() === entry.id}
						style={
							tab() === entry.id
								? {
										"view-transition-name": `tab-${tabsId}`,
										"view-transition-class": "tab",
									}
								: undefined
						}
						onClick={() => withViewTransition(() => setTab(entry.id))}
					>
						{entry.label()}
					</button>
				))}
			</div>
			<QuestionFrame
				number={1}
				title={props.data.title}
				tone="text-base-content"
				points={WHOLE ?? "100"}
			>
				<QuestionPreview {...props} tab={tab} />
			</QuestionFrame>
		</div>
	);
}
