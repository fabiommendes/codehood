import { actions } from "astro:actions";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	type JSX,
	onCleanup,
	Show,
} from "solid-js";
import FormAlert from "@/components/form/FormAlert";
import Link from "@/components/Link";
import Badge from "@/components/ui/Badge";
import PaginatedTable from "@/components/ui/PaginatedTable";
import type { CursorPage } from "@/components/ui/Pagination";
import type { ColumnConfig } from "@/components/ui/Table";
import ToggleGroup from "@/components/ui/ToggleGroup";
import { toggleSortState } from "@/components/ui/table-sort";
import type { Question } from "@/db/services/question.service";
import { errorMessage } from "@/forms/field-errors";
import { locale, m } from "@/i18n";
import { webNext } from "@/services/question-status";
import { type CourseRef, type Href, urls, withSearch } from "@/urls";
import {
	questionStatusLabels,
	questionTypeLabels,
	statusBadgeClass,
} from "@/utils/question-display";
import {
	QUESTION_STATUSES,
	QUESTION_TYPES,
	type QuestionListQuery,
	type QuestionListSortField,
	questionListSearch,
} from "@/utils/question-list-query";
import { ArchiveIcon, DraftIcon, GoIcon, PublishIcon } from "./icons";

/// A question row as this table renders it — `Question` minus the raw
/// database id, which never reaches the browser.
type QuestionRow = Omit<Question, "id">;

interface Props {
	/// One page of the questions, as the server filtered and ordered them.
	questions: QuestionRow[];
	/// Links to the pages around this one, and the questions that match the filters in all.
	cursor: CursorPage;
	/// The questions of the bank, whatever the filters.
	bankTotal: number;
	/// Every tag a question of the bank carries, in the order of the menu.
	tags: string[];
	/// The filters and the order this page was read with.
	query: QuestionListQuery;
	/// The query of the page, which a change of filter starts from.
	search: string;
	/** The course the bank belongs to, which the questions link under. */
	courseRef: CourseRef;
	/** The course's URL segments, needed by the Actions column's status-cycle control. */
	discipline: string;
	course: string;
}

const STATUS_LABELS = questionStatusLabels;

/// What the status button shows, keyed by the status it moves *to* — the
/// button expresses the outcome of clicking it, not the state it's leaving.
const STATUS_ACTION: Record<
	Question["status"],
	{ label: string; Icon: () => JSX.Element; tone?: string }
> = {
	PUBLISHED: {
		label: m.questions_action_publish(),
		Icon: PublishIcon,
		tone: "text-success",
	},
	HIDDEN: { label: m.questions_action_hide(), Icon: ArchiveIcon },
	ARCHIVED: { label: m.questions_action_archive(), Icon: ArchiveIcon },
	DRAFT: { label: m.questions_action_draft(), Icon: DraftIcon },
};

function titleOf(question: QuestionRow): string {
	return question.question.title ?? question.slug;
}

/**
 * One page of the course's question bank, with the controls that filter and
 * sort it.
 *
 * The server filters, orders and pages the rows: a filter or a column header
 * leads to the first page of the list it asks for, with the choice in the
 * query string.
 */
export default function QuestionsTable(props: Props): JSX.Element {
	const [typeMenuOpen, setTypeMenuOpen] = createSignal(false);
	const [tagMenuOpen, setTagMenuOpen] = createSignal(false);

	const links = urls.course(props.courseRef);

	/// The address of the first page of the bank under `query`.
	const hrefOf = (query: QuestionListQuery): Href =>
		withSearch(links.questions(), questionListSearch(props.search, query));

	/// Leaves for the bank with `change` applied to the filters of this page.
	function show(change: Partial<QuestionListQuery>): void {
		window.location.assign(hrefOf({ ...props.query, ...change }));
	}

	/// `items` with `item` added, or removed when it is already there.
	const toggled = <Item,>(items: Item[], item: Item): Item[] =>
		items.includes(item) ? items.filter((it) => it !== item) : [...items, item];

	// `props.questions` comes from Astro and never changes underneath us, so a
	// status the Actions column just set is tracked here — keyed by slug —
	// and layered over the prop rather than mutated in place.
	const [statusOverrides, setStatusOverrides] = createSignal<
		Record<string, Question["status"]>
	>({});
	const [pendingSlugs, setPendingSlugs] = createSignal<Set<string>>(new Set());
	/// The `updatedAt` each write returned, by slug: the version the next write expects.
	const [versionOverrides, setVersionOverrides] = createSignal<
		Record<string, Date>
	>({});
	const [failure, setFailure] = createSignal<string | null>(null);

	let typeMenuRoot: HTMLDivElement | undefined;
	let tagMenuRoot: HTMLDivElement | undefined;

	/// `props.questions` with any locally-applied status override layered on
	/// top — what the table renders instead of the raw prop.
	const effectiveQuestions = createMemo(() => {
		const overrides = statusOverrides();
		const versions = versionOverrides();
		if (Object.keys(overrides).length === 0) return props.questions;
		return props.questions.map((question) => {
			const status = overrides[question.slug];
			const updatedAt = versions[question.slug];
			return status === undefined
				? question
				: { ...question, status, updatedAt: updatedAt ?? question.updatedAt };
		});
	});

	createEffect(() => {
		if (!typeMenuOpen()) return;

		const onPointerDown = (event: PointerEvent) => {
			if (!typeMenuRoot?.contains(event.target as Node)) setTypeMenuOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		onCleanup(() => document.removeEventListener("pointerdown", onPointerDown));
	});

	createEffect(() => {
		if (!tagMenuOpen()) return;

		const onPointerDown = (event: PointerEvent) => {
			if (!tagMenuRoot?.contains(event.target as Node)) setTagMenuOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		onCleanup(() => document.removeEventListener("pointerdown", onPointerDown));
	});

	/**
	 * Cycles a question's status (DRAFT → PUBLISHED ⇄ HIDDEN; ARCHIVED → DRAFT),
	 * optimistically reflecting the new status in the table and rolling back
	 * if the action fails.
	 */
	async function cycleStatus(question: QuestionRow): Promise<void> {
		const previous = question.status;
		const next = webNext[previous];

		setPendingSlugs((current) => new Set(current).add(question.slug));
		setStatusOverrides((current) => ({ ...current, [question.slug]: next }));
		setFailure(null);

		const { data, error } = await actions.question.updateStatus({
			discipline: props.discipline,
			course: props.course,
			slug: question.slug,
			status: next,
			updatedAt: question.updatedAt.toISOString(),
		});

		if (error) {
			setStatusOverrides((current) => ({
				...current,
				[question.slug]: previous,
			}));
			setFailure(errorMessage(error));
		} else {
			setVersionOverrides((current) => ({
				...current,
				[question.slug]: data.updatedAt,
			}));
		}

		setPendingSlugs((current) => {
			const next = new Set(current);
			next.delete(question.slug);
			return next;
		});
	}

	const hasActiveFilters = () =>
		props.query.statuses.length > 0 ||
		props.query.types.length > 0 ||
		props.query.tags.length > 0;

	const clearFilters = () => show({ statuses: [], types: [], tags: [] });

	const columns: ColumnConfig<QuestionRow>[] = [
		{
			title: m.questions_table_col_title(),
			class: "font-medium",
			sortKey: "title" satisfies QuestionListSortField,
			render: (question) => (
				<Link href={links.question(question.slug)} class="link link-hover">
					{titleOf(question)}
				</Link>
			),
		},
		{
			title: m.questions_table_col_type(),
			class: "text-muted",
			sortKey: "type" satisfies QuestionListSortField,
			render: (question) => questionTypeLabels[question.question.type],
		},
		{
			title: m.questions_table_col_status(),
			sortKey: "status" satisfies QuestionListSortField,
			render: (question) => (
				<span class={`badge badge-sm ${statusBadgeClass(question.status)}`}>
					{STATUS_LABELS[question.status]}
				</span>
			),
		},
		{
			title: m.questions_table_col_tags(),
			render: (question) => (
				<div class="flex flex-wrap gap-1">
					<For each={question.question.tags ?? []}>
						{(tag) => (
							<Badge size="xs" style="outline">
								{tag}
							</Badge>
						)}
					</For>
				</div>
			),
		},
		{
			title: m.questions_table_col_updated(),
			class: "text-muted",
			sortKey: "updated" satisfies QuestionListSortField,
			render: (question) =>
				question.updatedAt.toLocaleDateString(locale, {
					month: "short",
					day: "numeric",
				}),
		},
		{
			title: m.questions_table_col_actions(),
			class: "text-right",
			headerClass: "text-right",
			render: (question) => {
				const action = STATUS_ACTION[webNext[question.status]];
				const pending = () => pendingSlugs().has(question.slug);
				return (
					<div class="flex justify-end gap-1">
						<button
							type="button"
							class={`btn btn-ghost btn-square btn-sm ${action.tone ?? ""}`}
							disabled={pending()}
							aria-label={action.label}
							title={action.label}
							onClick={() => cycleStatus(question)}
						>
							<action.Icon />
						</button>
						<Link
							href={links.question(question.slug)}
							class="btn btn-ghost btn-square btn-sm"
							aria-label={m.questions_open_named({ title: titleOf(question) })}
							title={m.questions_open_title()}
						>
							<GoIcon />
						</Link>
					</div>
				);
			},
		},
	];

	return (
		<div class="mt-4 flex flex-col gap-4">
			<FormAlert error={failure() ?? undefined} />
			<div class="flex flex-wrap items-center gap-3">
				<ToggleGroup<QuestionListQuery["statuses"][number]>
					mode="multiple"
					label={m.questions_table_col_status()}
					options={QUESTION_STATUSES.map((value) => ({
						value,
						label: STATUS_LABELS[value],
					}))}
					value={props.query.statuses}
					onChange={(statuses) => show({ statuses })}
				/>

				<div
					ref={typeMenuRoot}
					class={`dropdown ${typeMenuOpen() ? "dropdown-open" : ""}`}
				>
					<button
						type="button"
						class="btn btn-sm"
						onClick={() => setTypeMenuOpen((open) => !open)}
					>
						{m.questions_table_col_type()}
						<Show when={props.query.types.length > 0}>
							<span class="badge badge-sm">{props.query.types.length}</span>
						</Show>
					</button>
					<Show when={typeMenuOpen()}>
						<div class="dropdown-content z-10 mt-1 flex w-56 flex-col gap-1 rounded-box border border-edge bg-base-100 p-2 shadow-lg">
							<For each={QUESTION_TYPES}>
								{(type) => (
									<label class="flex cursor-pointer items-center gap-2 rounded-field px-2 py-1 text-sm hover:bg-base-200">
										<input
											type="checkbox"
											class="checkbox checkbox-sm"
											checked={props.query.types.includes(type)}
											onChange={() =>
												show({ types: toggled(props.query.types, type) })
											}
										/>
										{questionTypeLabels[type]}
									</label>
								)}
							</For>
							<Show when={props.query.types.length > 0}>
								<button
									type="button"
									class="btn btn-ghost btn-xs self-end"
									onClick={() => show({ types: [] })}
								>
									{m.questions_filter_clear()}
								</button>
							</Show>
						</div>
					</Show>
				</div>

				<Show when={props.tags.length > 0}>
					<div
						ref={tagMenuRoot}
						class={`dropdown ${tagMenuOpen() ? "dropdown-open" : ""}`}
					>
						<button
							type="button"
							class="btn btn-sm"
							onClick={() => setTagMenuOpen((open) => !open)}
						>
							{m.questions_table_col_tags()}
							<Show when={props.query.tags.length > 0}>
								<span class="badge badge-sm">{props.query.tags.length}</span>
							</Show>
						</button>
						<Show when={tagMenuOpen()}>
							<div class="dropdown-content z-10 mt-1 flex w-56 flex-col gap-1 rounded-box border border-edge bg-base-100 p-2 shadow-lg">
								<For each={props.tags}>
									{(tag) => (
										<label class="flex cursor-pointer items-center gap-2 rounded-field px-2 py-1 text-sm hover:bg-base-200">
											<input
												type="checkbox"
												class="checkbox checkbox-sm"
												checked={props.query.tags.includes(tag)}
												onChange={() =>
													show({ tags: toggled(props.query.tags, tag) })
												}
											/>
											{tag}
										</label>
									)}
								</For>
								<Show when={props.query.tags.length > 0}>
									<button
										type="button"
										class="btn btn-ghost btn-xs self-end"
										onClick={() => show({ tags: [] })}
									>
										{m.questions_filter_clear()}
									</button>
								</Show>
							</div>
						</Show>
					</div>
				</Show>

				<span class="text-sm text-muted">
					{m.questions_table_count({
						shown: props.cursor.total ?? props.questions.length,
						total: props.bankTotal,
					})}
				</span>

				<Show when={hasActiveFilters()}>
					<button
						type="button"
						class="btn btn-ghost btn-sm"
						onClick={clearFilters}
					>
						{m.questions_filter_clear_all()}
					</button>
				</Show>
			</div>

			<Show
				when={props.bankTotal > 0}
				fallback={<p class="text-sm text-muted">{m.questions_table_empty()}</p>}
			>
				<Show
					when={props.questions.length > 0}
					fallback={
						<p class="text-sm text-muted">
							{m.questions_table_no_match()}{" "}
							<button type="button" class="link" onClick={clearFilters}>
								{m.questions_filter_clear_all()}
							</button>
						</p>
					}
				>
					<PaginatedTable
						columns={columns}
						data={effectiveQuestions()}
						cursor={props.cursor}
						sort={{
							key: props.query.sort.field,
							direction: props.query.sort.direction,
						}}
						sortHref={(key) =>
							hrefOf({
								...props.query,
								sort: toggleSortState(
									props.query.sort,
									key as QuestionListSortField,
								),
							})
						}
					/>
				</Show>
			</Show>
		</div>
	);
}
