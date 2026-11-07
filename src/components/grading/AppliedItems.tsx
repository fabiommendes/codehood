import { For, type JSX, Show } from "solid-js";
import { scoreValue } from "@/core/score";
import { m } from "@/i18n";

/// A rubric item a grading pass applies, as its reader may see it.
export interface AppliedItem {
	text: string;
	/// Signed fraction of the question score, as stored.
	value: string;
	/// For the student; shown when present.
	feedback: string | null;
	/// For the graders only. Never present in what a student reads.
	comment?: string | null;
}

/**
 * A value as a signed whole percentage, e.g. `0.6` as `+60%` and `-0.1` as `-10%`.
 *
 * A value of zero has no sign.
 */
export function signedPercent(value: string): string {
	const number = scoreValue(value) ?? 0;
	const percent = Math.round(Number((Math.abs(number) * 100).toPrecision(12)));
	if (percent === 0) return "0%";
	return `${number < 0 ? "-" : "+"}${percent}%`;
}

/**
 * The rubric items applied to an answer, each with its value and the feedback written for the student.
 *
 * Shows the private comment of an item when the item carries one, which only
 * what an instructor reads does.
 */
export default function AppliedItems(props: {
	items: AppliedItem[];
}): JSX.Element {
	return (
		<Show when={props.items.length > 0}>
			<ul
				aria-label={m.grades_rubric_items_label()}
				class="mt-2 flex flex-col gap-2"
			>
				<For each={props.items}>
					{(item) => (
						<li class="rounded-box bg-base-200/50 px-3 py-2 text-sm">
							<p>
								<span class="font-medium">{item.text}</span>{" "}
								<span class="text-muted">{signedPercent(item.value)}</span>
							</p>
							<Show when={item.feedback}>
								<p class="mt-1 whitespace-pre-wrap text-base-content/70">
									{item.feedback}
								</p>
							</Show>
							<Show when={item.comment}>
								<p class="mt-1 whitespace-pre-wrap text-warning-content/80">
									{m.grades_rubric_private_comment()}: {item.comment}
								</p>
							</Show>
						</li>
					)}
				</For>
			</ul>
		</Show>
	);
}
