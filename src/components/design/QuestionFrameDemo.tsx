import type { JSX } from "solid-js";
import { QuestionFrame } from "@/components/exam/QuestionFrame";

/** The frame of an exam question in three states, over made-up answers, for the design catalogue. */
export default function QuestionFrameDemo(): JSX.Element {
	return (
		<div class="flex flex-col gap-10">
			<QuestionFrame
				number={1}
				title="Binary search"
				tone="text-base-content"
				points="25"
				status={<span class="badge badge-success badge-sm">Saved</span>}
				side={() => (
					<button type="button" class="btn btn-ghost btn-xs -mr-1.5 px-1.5">
						Clear
					</button>
				)}
			>
				<p>What is the time complexity of binary search on a sorted array?</p>
			</QuestionFrame>
			<QuestionFrame
				number={2}
				tone="text-base-content/50"
				points="12.5"
				status={<span class="badge badge-warning badge-sm">Saving</span>}
			>
				<p>A question with no title of its own falls back to its number.</p>
			</QuestionFrame>
			<QuestionFrame
				number={3}
				title="A title long enough to be cut by the tab it sits on, so the tab never outgrows the card"
				tone="text-error"
				points="62.5"
				status={<span class="badge badge-error badge-sm">Failed</span>}
			>
				<p>A failed save paints the number red.</p>
			</QuestionFrame>
		</div>
	);
}
