import type { JSX } from "solid-js";
import { Show } from "solid-js";
import type { QuestionPublic } from "@/db";
import { locale, m } from "@/i18n";

/// Tailwind scroll margin of a question, so a jump to it clears the attempt bar.
export const QUESTION_SCROLL_MARGIN = "scroll-mt-48";

export interface QuestionFrameProps {
	/// The question's position in the exam, from 1.
	number: number;
	/// The question's own title; the frame falls back to "Question N".
	title?: string;
	/// Text color class of the question number.
	tone: string;
	/// The question's share of the exam as points (`formatPoints`), or null when the exam has no weights.
	points: string | null;
	/// Shown under the points in the side column, and at the end of the card on narrow screens.
	side?: () => JSX.Element;
	/// Shown at the end of the title tab, such as the save state.
	status?: JSX.Element;
	/// Handlers on the card body, which every control of the question bubbles to.
	onFocusOut?: () => void;
	onBeforeInput?: (event: InputEvent) => void;
	children: JSX.Element;
}

/**
 * One exam question as a student sees it: the number in a side column, the
 * title on a file-folder tab, and the answer inside a card.
 */
export function QuestionFrame(props: QuestionFrameProps): JSX.Element {
	return (
		<section
			id={`question-${props.number}`}
			aria-label={m.exams_attempt_question_label({ number: props.number })}
			class={`grid gap-x-4 sm:grid-cols-[4.5rem_1fr] sm:grid-rows-[auto_1fr] ${QUESTION_SCROLL_MARGIN}`}
		>
			{/* The number stays in view while a long question scrolls past. */}
			<div class="hidden sm:col-start-1 sm:row-start-2 sm:block">
				<div class="sticky top-48 text-right">
					<QuestionNumber
						number={props.number}
						tone={props.tone}
						class="block text-4xl"
					/>
					<Show when={props.points}>
						{(points) => (
							<>
								<p class="mt-2 text-xs text-muted">
									{m.exams_attempt_points_label()}
								</p>
								<p class="text-sm font-semibold tabular-nums">
									{m.exams_attempt_points_value({ points: points() })}
								</p>
							</>
						)}
					</Show>
					<div class="mt-3">{props.side?.()}</div>
				</div>
			</div>
			{/* A file-folder tab: as wide as the title, its right edge slanted. */}
			<header class="relative z-10 inline-flex min-w-1/3 max-w-[calc(100%-1.5rem)] items-baseline gap-3 justify-self-start sm:col-start-2 py-2 pr-6 pl-6">
				<span
					aria-hidden="true"
					class="absolute inset-y-0 left-0 right-2 -z-10 rounded-tl-[18px_8px] bg-linear-to-b from-base-300 to-[color-mix(in_oklab,var(--color-base-300)_75%,var(--color-base-200))] shadow-[inset_0_1px_0_color-mix(in_oklab,var(--color-base-100)_70%,transparent)]"
				/>
				<span
					aria-hidden="true"
					class="absolute inset-y-0 -right-3 -z-10 w-9 origin-bottom skew-x-[18deg] rounded-tr-xl bg-linear-to-b from-base-300 to-[color-mix(in_oklab,var(--color-base-300)_75%,var(--color-base-200))] shadow-[inset_0_1px_0_color-mix(in_oklab,var(--color-base-100)_70%,transparent)]"
				/>
				<QuestionNumber
					number={props.number}
					tone={props.tone}
					class="text-xl sm:hidden"
				/>
				<h3 class="min-w-0 truncate font-display text-base font-semibold text-shadow-[0_0_3px_var(--color-base-100),0_0_10px_var(--color-base-100),0_0_18px_var(--color-base-100)]">
					{props.title ??
						m.exams_attempt_question_label({ number: props.number })}
				</h3>
				<Show when={props.points}>
					{(points) => (
						<span class="whitespace-nowrap text-xs tabular-nums sm:hidden">
							{m.exams_attempt_points({ points: points() })}
						</span>
					)}
				</Show>
				{props.status}
			</header>
			<div class="card card-border min-w-0 overflow-hidden rounded-tl-none! bg-base-200/25 shadow-sm sm:col-start-2">
				{/* focusout bubbles, so leaving any control of the question reaches the handler. */}
				<div
					class="card-body"
					onFocusOut={() => props.onFocusOut?.()}
					onBeforeInput={(event) => props.onBeforeInput?.(event)}
				>
					{props.children}
					<div class="self-end sm:hidden">{props.side?.()}</div>
				</div>
			</div>
		</section>
	);
}

/// "Q3", the label students and instructors use to refer to a question.
export function QuestionNumber(props: {
	number: number;
	tone: string;
	class?: string;
}): JSX.Element {
	return (
		<span
			class={`font-display font-semibold leading-none tracking-tight ${props.tone} ${props.class ?? ""}`}
		>
			{m.exams_attempt_question_short({ number: props.number })}
		</span>
	);
}

/// The weight a question declares, 1 when it declares none.
export function weightOf(question: QuestionPublic["question"]): number {
	return question.weight ?? 1;
}

/// A part of the total as points out of 100, up to one decimal: `15`, `7.5`.
export function formatPoints(share: number): string {
	return (share * 100).toLocaleString(locale, { maximumFractionDigits: 1 });
}

/**
 * The points each question carries, in exam order, or nulls when every
 * question weighs the default 1 and weights would only add noise.
 */
export function pointsOf(
	questions: readonly { question: QuestionPublic["question"] }[],
): (string | null)[] {
	const weights = questions.map((entry) => weightOf(entry.question));
	const total = weights.reduce((sum, weight) => sum + weight, 0);
	if (weights.every((weight) => weight === 1)) return weights.map(() => null);
	return weights.map((weight) => formatPoints(total > 0 ? weight / total : 0));
}
