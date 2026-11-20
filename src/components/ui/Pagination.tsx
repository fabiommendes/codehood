import type { JSX } from "solid-js";
import { For, Show } from "solid-js";
import Link from "@/components/Link";
import { locale, m } from "@/i18n";
import type { Href } from "@/urls";
import { pageSlots } from "./pagination";

/// Classes shared by every button of a pager.
const ITEM = "join-item btn btn-sm";

/// The pager's row: a summary on the left, the controls on the right.
function PagerRow(props: {
	summary?: JSX.Element;
	children: JSX.Element;
}): JSX.Element {
	return (
		<nav
			aria-label={m.common_pagination_label()}
			class="mt-3 flex flex-wrap items-center justify-between gap-2"
		>
			<span class="text-sm text-muted">{props.summary}</span>
			<div class="join">{props.children}</div>
		</nav>
	);
}

interface PaginationProps {
	/// The current page, 1-based.
	page: number;
	/// How many pages exist; the pager hides itself when there is only one.
	pageCount: number;
	onChange: (page: number) => void;
	/// Text beside the controls, such as "1–50 of 230".
	summary?: JSX.Element;
}

/**
 * A numbered page selector for rows held in the browser: previous, the pages
 * around the current one, next.
 */
export default function Pagination(props: PaginationProps): JSX.Element {
	return (
		<Show when={props.pageCount > 1}>
			<PagerRow summary={props.summary}>
				<button
					type="button"
					class={ITEM}
					disabled={props.page <= 1}
					onClick={() => props.onChange(props.page - 1)}
				>
					<span aria-hidden="true">‹</span>
					<span class="sr-only">{m.common_pagination_previous()}</span>
				</button>
				<For each={pageSlots(props.page, props.pageCount)}>
					{(slot) =>
						slot === "gap" ? (
							<span class={`${ITEM} btn-disabled`} aria-hidden="true">
								…
							</span>
						) : (
							<button
								type="button"
								class={`${ITEM} ${slot === props.page ? "btn-active" : ""}`}
								aria-current={slot === props.page ? "page" : undefined}
								aria-label={m.common_pagination_page({ page: slot })}
								onClick={() => props.onChange(slot)}
							>
								{slot}
							</button>
						)
					}
				</For>
				<button
					type="button"
					class={ITEM}
					disabled={props.page >= props.pageCount}
					onClick={() => props.onChange(props.page + 1)}
				>
					<span aria-hidden="true">›</span>
					<span class="sr-only">{m.common_pagination_next()}</span>
				</button>
			</PagerRow>
		</Show>
	);
}

/**
 * Links to the previous and next pages of rows paginated on the server.
 *
 * A cursor gives no page numbers, so the pager only steps back and forth;
 * an absent href disables that direction.
 */
export interface CursorPage {
	prevHref?: Href;
	nextHref?: Href;
	/// Rows across all pages, when the server counts them.
	total?: number;
}

/** A previous/next pager over links, for rows paginated on the server with cursors. */
export function CursorPagination(props: CursorPage): JSX.Element {
	const link = (href: Href | undefined, content: JSX.Element) => (
		<Show
			when={href}
			fallback={
				<span class={`${ITEM} btn-disabled`} aria-disabled="true">
					{content}
				</span>
			}
		>
			{(target) => (
				<Link class={ITEM} href={target()}>
					{content}
				</Link>
			)}
		</Show>
	);
	return (
		<Show when={props.prevHref || props.nextHref}>
			<PagerRow
				summary={
					props.total === undefined
						? undefined
						: m.common_pagination_total({
								total: props.total.toLocaleString(locale),
							})
				}
			>
				{link(
					props.prevHref,
					<>
						<span aria-hidden="true">‹</span> {m.common_pagination_previous()}
					</>,
				)}
				{link(
					props.nextHref,
					<>
						{m.common_pagination_next()} <span aria-hidden="true">›</span>
					</>,
				)}
			</PagerRow>
		</Show>
	);
}
