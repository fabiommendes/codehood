import {
	createEffect,
	createMemo,
	createSignal,
	For,
	type JSX,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import Badge from "@/components/ui/Badge";
import Table, { type ColumnConfig } from "@/components/ui/Table";
import type { QuestionType } from "@/core/schemas";
import type { Question } from "@/db/services/question.service";
import { questionTypeLabels, statusBadgeClass } from "@/utils/question-display";
import type { AssertEqual } from "@/utils/types";

interface Props {
	questions: Question[];
	/** The course's base URL, e.g. `/cs101/ada_2026-1` — questions link to `${href}/questions/${slug}`. */
	href: string;
}

// `@/core/schemas` pulls in a `z.instanceof(Buffer)` schema that only exists
// server-side, so this island cannot import the `questionStatus`/`questionType`
// zod enums at runtime without breaking hydration. These literal tuples are
// pinned against the schema's own types below, so an enum drifting out of
// sync with this list fails to compile instead of silently under-filtering.
const STATUS_OPTIONS = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
true satisfies AssertEqual<(typeof STATUS_OPTIONS)[number], Question["status"]>;

const TYPE_OPTIONS = [
	"multiple-choice",
	"multiple-selection",
	"true-false",
	"essay",
	"numeric",
	"short-answer",
	"fill-in",
] as const;
true satisfies AssertEqual<(typeof TYPE_OPTIONS)[number], QuestionType>;

const STATUS_LABELS: Record<Question["status"], string> = {
	DRAFT: "Draft",
	PUBLISHED: "Published",
	ARCHIVED: "Archived",
};

/// Lowercase URL spellings for the status filter, keyed by the schema's uppercase values.
const STATUS_PARAM: Record<Question["status"], string> = {
	DRAFT: "draft",
	PUBLISHED: "published",
	ARCHIVED: "archived",
};

type SortKey = "title-asc" | "title-desc" | "updated-asc" | "updated-desc";

const DEFAULT_SORT: SortKey = "updated-desc";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
	{ value: "updated-desc", label: "Recently updated" },
	{ value: "updated-asc", label: "Least recently updated" },
	{ value: "title-asc", label: "Title (A–Z)" },
	{ value: "title-desc", label: "Title (Z–A)" },
];

function statusesFromParam(value: string | null): Set<Question["status"]> {
	if (!value) return new Set();
	const requested = new Set(value.split(","));
	return new Set(
		STATUS_OPTIONS.filter((status) => requested.has(STATUS_PARAM[status])),
	);
}

function typesFromParam(
	value: string | null,
): Set<Question["question"]["type"]> {
	if (!value) return new Set();
	const requested = new Set(value.split(","));
	return new Set(TYPE_OPTIONS.filter((type) => requested.has(type)));
}

/// Tags are free-form, so each one is percent-encoded on the way out and
/// decoded on the way in rather than assumed to be a bare slug.
function tagsFromParam(value: string | null): Set<string> {
	if (!value) return new Set();
	return new Set(value.split(",").map((tag) => decodeURIComponent(tag)));
}

function sortFromParam(value: string | null): SortKey {
	return SORT_OPTIONS.some((option) => option.value === value)
		? (value as SortKey)
		: DEFAULT_SORT;
}

/** Reads the current filter/sort state from the page's query string. */
function readStateFromUrl(): {
	statuses: Set<Question["status"]>;
	types: Set<Question["question"]["type"]>;
	tags: Set<string>;
	sort: SortKey;
} {
	const params = new URLSearchParams(window.location.search);
	return {
		statuses: statusesFromParam(params.get("status")),
		types: typesFromParam(params.get("type")),
		tags: tagsFromParam(params.get("tags")),
		sort: sortFromParam(params.get("sort")),
	};
}

function titleOf(question: Question): string {
	return question.question.title ?? question.slug;
}

/**
 * The course's question bank as a filterable, sortable table.
 *
 * Filtering and sorting run entirely client-side over the array passed in —
 * a course's question bank is small enough that there is no reason to round
 * trip to the server for it. State mirrors into the URL query string with
 * `history.replaceState` so a filtered view survives a refresh and the back
 * button without ever triggering a navigation.
 */
export default function QuestionsTable(props: Props): JSX.Element {
	const [statuses, setStatuses] = createSignal<Set<Question["status"]>>(
		new Set(),
	);
	const [types, setTypes] = createSignal<Set<Question["question"]["type"]>>(
		new Set(),
	);
	const [tags, setTags] = createSignal<Set<string>>(new Set());
	const [sort, setSort] = createSignal<SortKey>(DEFAULT_SORT);
	const [typeMenuOpen, setTypeMenuOpen] = createSignal(false);
	const [tagMenuOpen, setTagMenuOpen] = createSignal(false);

	let typeMenuRoot: HTMLDivElement | undefined;
	let tagMenuRoot: HTMLDivElement | undefined;

	/// Every tag any question in the bank carries, deduplicated and sorted —
	/// the source of truth for both the dropdown's options and which tags a
	/// URL-supplied selection is still allowed to keep.
	const availableTags = createMemo(() => {
		const seen = new Set<string>();
		for (const question of props.questions) {
			for (const tag of question.question.tags ?? []) seen.add(tag);
		}
		return [...seen].sort((a, b) => a.localeCompare(b));
	});

	onMount(() => {
		const initial = readStateFromUrl();
		const validTags = new Set(availableTags());
		setStatuses(initial.statuses);
		setTypes(initial.types);
		setTags(new Set([...initial.tags].filter((tag) => validTags.has(tag))));
		setSort(initial.sort);
	});

	// Keeps the URL in sync without ever navigating — `replaceState` so
	// clicking through filters does not pile up history entries.
	createEffect(() => {
		const params = new URLSearchParams();
		const currentStatuses = statuses();
		const currentTypes = types();
		const currentTags = tags();
		const currentSort = sort();

		if (currentStatuses.size > 0) {
			params.set(
				"status",
				STATUS_OPTIONS.filter((status) => currentStatuses.has(status))
					.map((status) => STATUS_PARAM[status])
					.join(","),
			);
		}
		if (currentTypes.size > 0) {
			params.set(
				"type",
				TYPE_OPTIONS.filter((type) => currentTypes.has(type)).join(","),
			);
		}
		if (currentTags.size > 0) {
			params.set(
				"tags",
				[...currentTags].map((tag) => encodeURIComponent(tag)).join(","),
			);
		}
		if (currentSort !== DEFAULT_SORT) params.set("sort", currentSort);

		const query = params.toString();
		const url = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
		window.history.replaceState(window.history.state, "", url);
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

	function toggleStatus(status: Question["status"]): void {
		setStatuses((current) => {
			const next = new Set(current);
			if (next.has(status)) next.delete(status);
			else next.add(status);
			return next;
		});
	}

	function toggleType(type: Question["question"]["type"]): void {
		setTypes((current) => {
			const next = new Set(current);
			if (next.has(type)) next.delete(type);
			else next.add(type);
			return next;
		});
	}

	function toggleTag(tag: string): void {
		setTags((current) => {
			const next = new Set(current);
			if (next.has(tag)) next.delete(tag);
			else next.add(tag);
			return next;
		});
	}

	const hasActiveFilters = createMemo(
		() => statuses().size > 0 || types().size > 0 || tags().size > 0,
	);

	function clearFilters(): void {
		setStatuses(new Set<Question["status"]>());
		setTypes(new Set<Question["question"]["type"]>());
		setTags(new Set<string>());
	}

	const filtered = createMemo(() => {
		const currentStatuses = statuses();
		const currentTypes = types();
		const currentTags = tags();

		return props.questions.filter((question) => {
			if (currentStatuses.size > 0 && !currentStatuses.has(question.status)) {
				return false;
			}
			if (currentTypes.size > 0 && !currentTypes.has(question.question.type)) {
				return false;
			}
			if (currentTags.size > 0) {
				const questionTags = question.question.tags ?? [];
				if (!questionTags.some((tag) => currentTags.has(tag))) return false;
			}
			return true;
		});
	});

	const sorted = createMemo(() => {
		const rows = [...filtered()];
		switch (sort()) {
			case "title-asc":
				return rows.sort((a, b) => titleOf(a).localeCompare(titleOf(b)));
			case "title-desc":
				return rows.sort((a, b) => titleOf(b).localeCompare(titleOf(a)));
			case "updated-asc":
				return rows.sort(
					(a, b) => a.updatedAt.getTime() - b.updatedAt.getTime(),
				);
			default:
				return rows.sort(
					(a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
				);
		}
	});

	const columns: ColumnConfig<Question>[] = [
		{
			title: "Title",
			class: "font-medium",
			render: (question) => (
				<a
					href={`${props.href}/questions/${question.slug}`}
					class="link link-hover"
				>
					{titleOf(question)}
				</a>
			),
		},
		{
			title: "Type",
			class: "text-base-content/60",
			render: (question) => questionTypeLabels[question.question.type],
		},
		{
			title: "Status",
			render: (question) => (
				<span class={`badge badge-sm ${statusBadgeClass(question.status)}`}>
					{question.status}
				</span>
			),
		},
		{
			title: "Tags",
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
			title: "Updated",
			class: "text-base-content/60",
			render: (question) =>
				question.updatedAt.toLocaleDateString("en-US", {
					month: "short",
					day: "numeric",
				}),
		},
	];

	return (
		<div class="mt-4 flex flex-col gap-4">
			<div class="flex flex-wrap items-center gap-3">
				<div class="join">
					<For each={STATUS_OPTIONS}>
						{(option) => (
							<button
								type="button"
								aria-pressed={statuses().has(option)}
								class={`btn btn-sm join-item ${statuses().has(option) ? "btn-active" : ""}`}
								onClick={() => toggleStatus(option)}
							>
								{STATUS_LABELS[option]}
							</button>
						)}
					</For>
				</div>

				<div
					ref={typeMenuRoot}
					class={`dropdown ${typeMenuOpen() ? "dropdown-open" : ""}`}
				>
					<button
						type="button"
						class="btn btn-sm"
						onClick={() => setTypeMenuOpen((open) => !open)}
					>
						Type
						<Show when={types().size > 0}>
							<span class="badge badge-sm">{types().size}</span>
						</Show>
					</button>
					<Show when={typeMenuOpen()}>
						<div class="dropdown-content z-10 mt-1 flex w-56 flex-col gap-1 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg">
							<For each={TYPE_OPTIONS}>
								{(type) => (
									<label class="flex cursor-pointer items-center gap-2 rounded-field px-2 py-1 text-sm hover:bg-base-200">
										<input
											type="checkbox"
											class="checkbox checkbox-sm"
											checked={types().has(type)}
											onChange={() => toggleType(type)}
										/>
										{questionTypeLabels[type]}
									</label>
								)}
							</For>
						</div>
					</Show>
				</div>

				<Show when={availableTags().length > 0}>
					<div
						ref={tagMenuRoot}
						class={`dropdown ${tagMenuOpen() ? "dropdown-open" : ""}`}
					>
						<button
							type="button"
							class="btn btn-sm"
							onClick={() => setTagMenuOpen((open) => !open)}
						>
							Tags
							<Show when={tags().size > 0}>
								<span class="badge badge-sm">{tags().size}</span>
							</Show>
						</button>
						<Show when={tagMenuOpen()}>
							<div class="dropdown-content z-10 mt-1 flex w-56 flex-col gap-1 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg">
								<For each={availableTags()}>
									{(tag) => (
										<label class="flex cursor-pointer items-center gap-2 rounded-field px-2 py-1 text-sm hover:bg-base-200">
											<input
												type="checkbox"
												class="checkbox checkbox-sm"
												checked={tags().has(tag)}
												onChange={() => toggleTag(tag)}
											/>
											{tag}
										</label>
									)}
								</For>
							</div>
						</Show>
					</div>
				</Show>

				<select
					class="select select-sm w-auto"
					value={sort()}
					onChange={(event) => setSort(event.currentTarget.value as SortKey)}
					aria-label="Sort by"
				>
					<For each={SORT_OPTIONS}>
						{(option) => <option value={option.value}>{option.label}</option>}
					</For>
				</select>

				<span class="text-sm text-base-content/60">
					{sorted().length} of {props.questions.length} question
					{props.questions.length === 1 ? "" : "s"}
				</span>

				<Show when={hasActiveFilters()}>
					<button
						type="button"
						class="btn btn-ghost btn-sm"
						onClick={clearFilters}
					>
						Clear filters
					</button>
				</Show>
			</div>

			<Show
				when={props.questions.length > 0}
				fallback={<p class="text-sm text-base-content/60">No questions yet.</p>}
			>
				<Show
					when={sorted().length > 0}
					fallback={
						<p class="text-sm text-base-content/60">
							No questions match these filters.{" "}
							<button type="button" class="link" onClick={clearFilters}>
								Clear filters
							</button>
						</p>
					}
				>
					<Table columns={columns} data={sorted()} />
				</Show>
			</Show>
		</div>
	);
}
