import { actions } from "astro:actions";
import { type JSX, Show } from "solid-js";
import Field from "@/components/form/Field";
import FormAlert from "@/components/form/FormAlert";
import Badge from "@/components/ui/Badge";
import Table, { type ColumnConfig } from "@/components/ui/Table";
import type { editionForm } from "@/core/schemas";
import type { FormState } from "@/forms/form-state";
import { plural } from "@/utils/plural";

/**
 * One row's worth of pre-computed display data. Kept free of `Edition` and
 * the DB services on purpose — this component only knows how to render rows,
 * not where they come from — so the `.astro` page owns fetching editions,
 * counting their courses, and deciding whether each is live.
 */
export interface EditionRow {
	slug: string;
	name: string;
	startAt: Date;
	endAt: Date;
	courseCount: number;
	isLive: boolean;
}

interface Props {
	editions: EditionRow[];
	/// State of the edit form, as read from the action result of the page.
	editForm: FormState<typeof editionForm>;
	/// The slug whose edit failed, so only that row shows the errors and the typed values.
	failedSlug?: string;
}

// startAt/endAt are calendar dates with no meaningful time-of-day but are
// stored as UTC midnight, same as the <input type="date"> values they
// round-trip through — format/read in UTC too, or a negative-offset server
// timezone renders "2027-02-01" as "Jan 31".
function formatWindow(row: Pick<EditionRow, "startAt" | "endAt">): string {
	const short: Intl.DateTimeFormatOptions = {
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	};
	const start = row.startAt.toLocaleDateString("en-US", short);
	const end = row.endAt.toLocaleDateString("en-US", {
		...short,
		year: "numeric",
	});
	return `${start} – ${end}`;
}

function toDateInputValue(date: Date): string {
	return date.toISOString().slice(0, 10);
}

export default function EditionsTable(props: Props): JSX.Element {
	/// A field of `row`'s dialog: the stored value, or what was typed when
	/// that row's submit failed.
	const editField = (row: EditionRow, name: "name" | "startAt" | "endAt") => {
		const view = props.editForm.field(name);
		const failed = props.failedSlug === row.slug;
		const stored =
			name === "name"
				? row.name
				: toDateInputValue(name === "startAt" ? row.startAt : row.endAt);
		return {
			...view,
			id: `edit-edition-${row.slug}-${name}`,
			value: failed ? view.value : stored,
			errors: failed ? view.errors : [],
		};
	};

	const columns: ColumnConfig<EditionRow>[] = [
		{
			title: "Slug",
			class: "font-mono font-medium",
			render: (row) => row.slug,
		},
		{ title: "Name", render: (row) => row.name },
		{
			title: "Interval",
			class: "text-base-content/60",
			render: (row) => formatWindow(row),
		},
		{
			title: "Status",
			render: (row) =>
				row.isLive ? (
					<Badge variant="success" size="sm">
						live
					</Badge>
				) : (
					<Badge style="outline" size="sm">
						closed
					</Badge>
				),
		},
		{
			title: "Courses",
			class: "text-base-content/60",
			render: (row) => plural(row.courseCount, "course"),
		},
		{
			title: "Actions",
			class: "text-right",
			headerClass: "text-right",
			render: (row) => (
				<>
					<button
						type="button"
						class="btn btn-square btn-ghost btn-sm"
						aria-label={`Edit ${row.slug}`}
						title="Edit"
						data-open-dialog={`edit-edition-${row.slug}`}
					>
						<svg width="15" height="15" viewBox="0 0 24 24" fill="none">
							<title>Edit</title>
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
						action={actions.admin.deleteEdition}
						class="inline"
					>
						<input type="hidden" name="slug" value={row.slug} />
						<button
							type="submit"
							class={`btn btn-square btn-ghost btn-sm ${row.courseCount > 0 ? "text-base-content/30" : "text-error"}`}
							disabled={row.courseCount > 0}
							aria-label={`Delete ${row.slug}`}
							title={
								row.courseCount > 0
									? `${plural(row.courseCount, "course")} still use${row.courseCount === 1 ? "s" : ""} this edition`
									: "Delete"
							}
						>
							<svg width="15" height="15" viewBox="0 0 24 24" fill="none">
								<title>Delete {row.slug}</title>
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
									aria-label="Close"
								>
									✕
								</button>
							</form>
							<h3 class="text-lg font-bold">
								Edit <span class="font-mono">{row.slug}</span>
							</h3>
							<form
								method="post"
								action={actions.admin.updateEdition}
								class="mt-4 flex flex-col gap-4"
							>
								<input type="hidden" name="slug" value={row.slug} />
								<Show when={props.failedSlug === row.slug}>
									<FormAlert error={props.editForm.error} />
								</Show>
								<Field {...editField(row, "name")} />
								<Field {...editField(row, "startAt")} />
								<Field {...editField(row, "endAt")} />
								<div class="modal-action">
									<button type="submit" class="btn btn-primary">
										Save
									</button>
								</div>
							</form>
						</div>
						<form method="dialog" class="modal-backdrop">
							<button type="submit">close</button>
						</form>
					</dialog>
				</>
			),
		},
	];

	return <Table columns={columns} data={props.editions} class="mt-8" />;
}
