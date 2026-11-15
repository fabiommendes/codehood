/**
 * The filters and the order of the question bank page, as its URL spells
 * them: `?status=draft,hidden&type=essay&tags=a,b&sort=title&dir=asc`.
 *
 * Free of server-only imports, so the island of the page can use it.
 */

import type { z } from "zod";
import {
	applySortToParams,
	type SortState,
	sortStateFromParams,
} from "@/components/ui/table-sort";
import type {
	QuestionSortField,
	QuestionType,
	questionStatus,
} from "@/core/schemas";
import type { AssertEqual } from "./types";

type QuestionStatus = z.infer<typeof questionStatus>;

// `@/core/schemas` pulls in a `z.instanceof(Buffer)` schema that only exists
// server-side, so an island cannot import its zod enums at runtime. These
// literal tuples are pinned against the types of the schema instead, so an
// enum drifting out of sync with them fails to compile.
/// Every status of a question, in the order the filter shows them.
export const QUESTION_STATUSES = [
	"DRAFT",
	"PUBLISHED",
	"HIDDEN",
	"ARCHIVED",
] as const;
true satisfies AssertEqual<(typeof QUESTION_STATUSES)[number], QuestionStatus>;

/// Every type of question, in the order the filter shows them.
export const QUESTION_TYPES = [
	"multiple-choice",
	"multiple-selection",
	"true-false",
	"essay",
	"numeric",
	"short-answer",
	"fill-in",
	"ordering",
	"code",
] as const;
true satisfies AssertEqual<(typeof QUESTION_TYPES)[number], QuestionType>;

/// The columns of the question bank table that sort it.
export const QUESTION_SORT_FIELDS = [
	"title",
	"type",
	"status",
	"updated",
] as const satisfies readonly QuestionSortField[];
export type QuestionListSortField = (typeof QUESTION_SORT_FIELDS)[number];

/// The order of the question bank when its URL names none.
export const QUESTION_DEFAULT_SORT: SortState<QuestionListSortField> = {
	field: "updated",
	direction: "desc",
};

/// What the question bank page shows: empty lists filter nothing.
export interface QuestionListQuery {
	statuses: QuestionStatus[];
	types: QuestionType[];
	tags: string[];
	sort: SortState<QuestionListSortField>;
}

/// The names a comma-separated parameter asks for.
function listed(value: string | null): Set<string> {
	return new Set(value ? value.split(",") : []);
}

/**
 * Reads the filters and the order a question bank URL asks for, ignoring
 * what it does not recognize.
 *
 * @example
 * readQuestionListQuery(new URLSearchParams("status=draft&sort=title")).statuses; // ["DRAFT"]
 */
export function readQuestionListQuery(
	params: URLSearchParams,
): QuestionListQuery {
	const statuses = listed(params.get("status"));
	const types = listed(params.get("type"));
	return {
		statuses: QUESTION_STATUSES.filter((status) =>
			statuses.has(status.toLowerCase()),
		),
		types: QUESTION_TYPES.filter((type) => types.has(type)),
		// Tags are free-form, so each one is percent-encoded inside the list.
		tags: [...listed(params.get("tags"))].map((tag) => decodeURIComponent(tag)),
		sort: sortStateFromParams(
			params,
			QUESTION_SORT_FIELDS,
			QUESTION_DEFAULT_SORT,
		),
	};
}

/**
 * The query string of the first page of the question bank under `query`.
 *
 * Whatever else `search` carries, such as `limit`, is kept; its cursor is
 * dropped, since it belongs to the list as it was filtered and ordered before.
 *
 * @example
 * questionListSearch("?limit=2&after=abc", { ...query, statuses: ["DRAFT"] }); // "?limit=2&status=draft"
 *
 * @param search The query of the page being left, as `listUrl(url).search`.
 */
export function questionListSearch(
	search: string,
	query: QuestionListQuery,
): string {
	const params = new URLSearchParams(search);
	for (const name of [
		"after",
		"before",
		"status",
		"type",
		"tags",
		"sort",
		"dir",
	])
		params.delete(name);

	const statuses = QUESTION_STATUSES.filter((status) =>
		query.statuses.includes(status),
	);
	const types = QUESTION_TYPES.filter((type) => query.types.includes(type));
	if (statuses.length > 0)
		params.set("status", statuses.map((s) => s.toLowerCase()).join(","));
	if (types.length > 0) params.set("type", types.join(","));
	if (query.tags.length > 0)
		params.set(
			"tags",
			query.tags.map((tag) => encodeURIComponent(tag)).join(","),
		);
	applySortToParams(params, query.sort, QUESTION_DEFAULT_SORT);

	const text = params.toString();
	return text ? `?${text}` : "";
}
