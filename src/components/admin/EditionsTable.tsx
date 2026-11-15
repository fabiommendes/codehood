import { actions } from "astro:actions";
import { type JSX, Show } from "solid-js";
import Field from "@/components/form/Field";
import FormAlert from "@/components/form/FormAlert";
import Badge from "@/components/ui/Badge";
import PaginatedTable from "@/components/ui/PaginatedTable";
import type { CursorPage } from "@/components/ui/Pagination";
import type { ColumnConfig } from "@/components/ui/Table";
import type { editionForm } from "@/core/schemas";
import type { FormState } from "@/forms/form-state";
import { m, SLOT, splitAtSlot } from "@/i18n";
import type { IsoDate } from "@/typing/iso-date";
import { actionHref } from "@/utils/list-page";
import { formatIsoDate } from "@/utils/schedule-time";

/**
 * One row's worth of pre-computed display data. Kept free of `Edition` and
 * the DB services on purpose — this component only knows how to render rows,
 * not where they come from — so the `.astro` page owns fetching editions,
 * counting their courses, and deciding whether each is live.
 */
export interface EditionRow {
	slug: string;
	name: string;
	startDate: IsoDate;
	endDate: IsoDate;
	courseCount: number;
	isLive: boolean;
}

interface Props {
	/// One page of the editions.
	editions: EditionRow[];
	/// Links to the pages around this one, and the editions in all.
	cursor: CursorPage;
	/// The query of the page, which the forms of a row post back to.
	search: string;
	/// State of the edit form, as read from the action result of the page.
	editForm: FormState<typeof editionForm>;
	/// The slug whose edit failed, so only that row shows the errors and the typed values.
	failedSlug?: string;
}

function formatWindow(row: Pick<EditionRow, "startDate" | "endDate">): string {
	const start = formatIsoDate(row.startDate, { year: undefined });
	const end = formatIsoDate(row.endDate);
	return `${start} – ${end}`;
}

/// The heading of the edit dialog split around the slug, which is rendered apart.
const [EDIT_BEFORE, EDIT_AFTER] = splitAtSlot(
	m.admin_edit_slug({ slug: SLOT }),
);

export default function EditionsTable(props: Props): JSX.Element {
	/// A field of `row`'s dialog: the stored value, or what was typed when
	/// that row's submit failed.
	const editField = (
		row: EditionRow,
		name: "name" | "startDate" | "endDate",
	) => {
		const view = props.editForm.field(name);
		const failed = props.failedSlug === row.slug;
		const stored =
			name === "name"
				? row.name
				: name === "startDate"
					? row.startDate
					: row.endDate;
		return {
			...view,
			id: `edit-edition-${row.slug}-${name}`,
			value: failed ? view.value : stored,
			errors: failed ? view.errors : [],
		};
	};

	const columns: ColumnConfig<EditionRow>[] = [
		{
			title: m.admin_col_slug(),
			class: "font-mono font-medium",
			render: (row) => row.slug,
		},
		{ title: m.admin_col_name(), render: (row) => row.name },
		{
			title: m.admin_col_interval(),
			class: "text-muted",
			render: (row) => formatWindow(row),
		},
		{
			title: m.admin_col_status(),
			render: (row) =>
				row.isLive ? (
					<Badge variant="success" size="sm">
						{m.admin_edition_live()}
					</Badge>
				) : (
					<Badge style="outline" size="sm">
						{m.admin_edition_closed()}
					</Badge>
				),
		},
		{
			title: m.admin_col_courses(),
			class: "text-muted",
			render: (row) => m.admin_courses_count({ count: row.courseCount }),
		},
		{
			title: m.admin_col_actions(),
			class: "text-right",
			headerClass: "text-right",
			render: (row) => (
				<>
					<button
						type="button"
						class="btn btn-square btn-ghost btn-sm"
						aria-label={m.admin_edit_slug({ slug: row.slug })}
						title={m.admin_edit()}
						data-open-dialog={`edit-edition-${row.slug}`}
					>
						<svg width="15" height="15" viewBox="0 0 24 24" fill="none">
							<title>{m.admin_edit()}</title>
							<path
								d="M16.5 4.5 19.5 7.5 8 19H5v-3Z"
								stroke="currentColor"
								stroke-width="1.6"
								stroke-linejoin="round"
							/>
						</svg>
					</button>

					<form
						method="post"
						action={actionHref(actions.admin.deleteEdition, props.search)}
						class="inline"
					>
						<input type="hidden" name="slug" value={row.slug} />
						<button
							type="submit"
							class={`btn btn-square btn-ghost btn-sm ${row.courseCount > 0 ? "text-base-content/30" : "text-error"}`}
							disabled={row.courseCount > 0}
							aria-label={m.admin_delete_slug({ slug: row.slug })}
							title={
								row.courseCount > 0
									? m.admin_edition_in_use({ count: row.courseCount })
									: m.admin_delete()
							}
						>
							<svg width="15" height="15" viewBox="0 0 24 24" fill="none">
								<title>{m.admin_delete_slug({ slug: row.slug })}</title>
								<path
									d="M5 7h14M9.5 7V5.5a1.5 1.5 0 0 1 1.5-1.5h2a1.5 1.5 0 0 1 1.5 1.5V7M7 7l1 12.5A1.5 1.5 0 0 0 9.5 21h5a1.5 1.5 0 0 0 1.5-1.5L17 7"
									stroke="currentColor"
									stroke-width="1.6"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							</svg>
						</button>
					</form>

					<dialog
						id={`edit-edition-${row.slug}`}
						class="modal"
						data-reopen={props.failedSlug === row.slug ? "" : undefined}
					>
						<div class="modal-box">
							<form method="dialog">
								<button
									class="btn btn-circle btn-ghost btn-sm absolute right-2 top-2"
									type="submit"
									aria-label={m.admin_close()}
								>
									✕
								</button>
							</form>
							<h3 class="text-lg font-bold">
								{EDIT_BEFORE}
								<span class="font-mono">{row.slug}</span>
								{EDIT_AFTER}
							</h3>
							<form
								method="post"
								action={actionHref(actions.admin.updateEdition, props.search)}
								class="mt-4 flex flex-col gap-4"
							>
								<input type="hidden" name="slug" value={row.slug} />
								<Show when={props.failedSlug === row.slug}>
									<FormAlert error={props.editForm.error} />
								</Show>
								<Field {...editField(row, "name")} />
								<Field {...editField(row, "startDate")} />
								<Field {...editField(row, "endDate")} />
								<div class="modal-action">
									<button type="submit" class="btn btn-primary">
										{m.admin_save()}
									</button>
								</div>
							</form>
						</div>
						<form method="dialog" class="modal-backdrop">
							<button type="submit">{m.admin_close_backdrop()}</button>
						</form>
					</dialog>
				</>
			),
		},
	];

	return (
		<PaginatedTable
			columns={columns}
			data={props.editions}
			cursor={props.cursor}
			class="mt-8"
		/>
	);
}
