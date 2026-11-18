import { For, type JSX, Show } from "solid-js";
import { locale, m } from "@/i18n";
import type { NumericHistogram as Histogram } from "@/services/objective-review";

/// The tallest a bar may be, in pixels.
const MAX_BAR = 130;

/// A number as the page writes it: short, in the locale.
const format = (value: number): string =>
	value.toLocaleString(locale, { maximumFractionDigits: 4 });

/**
 * The values sent for a numeric question: a zoomed window around the key with its tolerance band, and the values outside it.
 *
 * Green bars are answers that scored full marks, grey the others.
 */
export default function NumericHistogram(props: {
	histogram: Histogram;
}): JSX.Element {
	const { band, window: axis } = props.histogram;
	const span = axis.high - axis.low || 1;
	const at = (value: number) => ((value - axis.low) / span) * 100;
	const tallest = Math.max(
		1,
		...props.histogram.bins.map((bin) => bin.count),
		...props.histogram.outside.map((bar) => bar.count),
	);
	/// Height in pixels of one answer in a bar.
	const PX = Math.min(8, MAX_BAR / tallest);
	const ticks = [0, 0.25, 0.5, 0.75, 1].map((step) => axis.low + step * span);
	return (
		<div
			class="grid gap-6 rounded-box border border-edge bg-base-100 p-6"
			style="grid-template-columns:minmax(0,2.2fr) minmax(0,1fr)"
		>
			<div>
				<div
					class="relative border-b border-base-content/30"
					style="height:10rem"
				>
					<div
						style={`background:color-mix(in oklab,var(--color-success) 18%,transparent);position:absolute;top:0;bottom:0;left:${at(band.low)}%;width:${Math.max(at(band.high) - at(band.low), 0.5)}%`}
					/>
					<span
						class="text-xs text-success"
						style={`position:absolute;top:0;left:${at(band.low)}%;white-space:nowrap;padding-left:2px`}
					>
						{m.grades_objective_tolerance({
							low: format(band.low),
							high: format(band.high),
						})}
					</span>
					<For each={props.histogram.bins}>
						{(bin) => (
							<div
								class="flex flex-col items-center justify-end"
								style={`position:absolute;bottom:0;width:3rem;transform:translateX(-50%);left:${at(bin.value)}%`}
							>
								<span class="text-xs tabular-nums">{bin.count}</span>
								<Show when={bin.count - bin.correct > 0}>
									<div
										class="w-full bg-base-content/30"
										style={{ height: `${(bin.count - bin.correct) * PX}px` }}
									/>
								</Show>
								<Show when={bin.correct > 0}>
									<div
										class="w-full bg-success"
										style={{ height: `${bin.correct * PX}px` }}
									/>
								</Show>
							</div>
						)}
					</For>
				</div>
				<div
					class="relative text-xs tabular-nums text-muted"
					style="height:1.5rem"
				>
					<For each={ticks}>
						{(tick) => (
							<span
								style={`position:absolute;transform:translateX(-50%);left:${at(tick)}%`}
							>
								{format(tick)}
							</span>
						)}
					</For>
				</div>
			</div>
			<div class="border-l border-dashed border-base-content/30 pl-6">
				<p class="text-xs text-muted">{m.grades_objective_outside_window()}</p>
				<div
					class="mt-1 flex items-end gap-6 border-b border-base-content/30"
					style="height:10rem"
				>
					<For each={props.histogram.outside}>
						{(bar) => (
							<div class="flex flex-col items-center">
								<span class="text-xs tabular-nums">{bar.count}</span>
								<div
									class="w-8 bg-base-content/30"
									style={{ height: `${bar.count * PX}px` }}
								/>
							</div>
						)}
					</For>
				</div>
				<div class="flex gap-6 text-xs tabular-nums text-muted">
					<For each={props.histogram.outside}>
						{(bar) => (
							<span class="w-8 text-center">
								{bar.value === null
									? m.grades_objective_others()
									: format(bar.value)}
							</span>
						)}
					</For>
				</div>
			</div>
		</div>
	);
}
