import { actions } from "astro:actions";
import type { JSX } from "solid-js";
import type { z } from "zod";
import SearchableTable from "@/components/ui/SearchableTable";
import type { ColumnConfig } from "@/components/ui/Table";
import type { enrollmentSchema } from "@/core/schemas/enrollment";
import { locale, m } from "@/i18n";

/// The columns this table renders — the full `enrollmentSchema` row minus the
/// course's raw database id, which never reaches the browser.
type EnrolledUser = Omit<z.infer<typeof enrollmentSchema>, "courseId">;

interface Props {
	students: EnrolledUser[];
	/// The course's URL segments, e.g. `discipline: "cs101"`, `course: "ada_2026-1"`.
	discipline: string;
	course: string;
	/// Controls shown beside the search box, such as the download and add buttons.
	children?: JSX.Element;
}

function formatDate(date: Date): string {
	return date.toLocaleDateString(locale, {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

/**
 * The Students tab's table, searchable by any of the student's fields.
 *
 * The drop control posts to the same `course.dropEnrollment` action a
 * student's own "Leave course" button uses, gated per-actor by
 * `enrollment.delete`.
 */
export default function StudentsTable(props: Props): JSX.Element {
	const columns: ColumnConfig<EnrolledUser>[] = [
		{
			title: m.courses_students_col_name(),
			class: "font-medium",
			render: (user) => user.name,
		},
		{
			title: m.courses_students_col_username(),
			class: "font-mono text-sm text-muted",
			render: (user) => `@${user.username}`,
		},
		{
			title: m.courses_students_col_email(),
			class: "text-muted",
			render: (user) => user.email,
		},
		{
			title: m.courses_students_col_github(),
			class: "font-mono text-sm text-muted",
			render: (user) => user.githubId,
		},
		{
			title: m.courses_students_col_school_id(),
			class: "font-mono text-sm text-muted",
			render: (user) => user.schoolId,
		},
		{
			title: m.courses_students_col_enrolled(),
			class: "text-muted",
			render: (user) => formatDate(user.enrolledAt),
		},
		{
			title: m.courses_students_col_actions(),
			class: "text-right",
			headerClass: "text-right",
			render: (user) => (
				<>
					<button
						type="button"
						class="btn btn-square btn-ghost btn-sm text-error"
						data-open-dialog={`drop-student-${user.username}`}
						aria-label={m.courses_students_drop_label({ name: user.name })}
						title={m.courses_students_drop()}
					>
						<svg
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="none"
							aria-hidden="true"
						>
							<path
								d="M15 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9 10.5a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5ZM16 11h6"
								stroke="currentColor"
								stroke-width="1.6"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					</button>

					<dialog id={`drop-student-${user.username}`} class="modal">
						<div class="modal-box">
							<form method="dialog">
								<button
									class="btn btn-circle btn-ghost btn-sm absolute right-2 top-2"
									type="submit"
									aria-label={m.courses_students_close()}
								>
									✕
								</button>
							</form>
							<h3 class="text-lg font-bold">
								{m.courses_students_drop_title({ name: user.name })}
							</h3>
							<p class="mt-2 text-sm text-base-content/70">
								{m.courses_students_drop_body()}
							</p>
							<form
								method="post"
								action={actions.course.dropEnrollment}
								class="modal-action"
							>
								<input
									type="hidden"
									name="discipline"
									value={props.discipline}
								/>
								<input type="hidden" name="course" value={props.course} />
								<input type="hidden" name="username" value={user.username} />
								{/* formmethod="dialog" overrides the form's post just for this button, so
								    Cancel closes the dialog without submitting the drop. */}
								<button type="submit" formmethod="dialog" class="btn btn-ghost">
									{m.courses_cancel()}
								</button>
								<button type="submit" class="btn btn-error">
									{m.courses_students_drop()}
								</button>
							</form>
						</div>
						<form method="dialog" class="modal-backdrop">
							<button type="submit">{m.courses_close_backdrop()}</button>
						</form>
					</dialog>
				</>
			),
		},
	];

	return (
		<SearchableTable
			columns={columns}
			data={props.students}
			searchText={(user) =>
				[user.name, user.username, user.email, user.githubId, user.schoolId]
					.filter(Boolean)
					.join(" ")
			}
			empty={m.courses_roster_empty()}
			class="mt-4"
		>
			{props.children}
		</SearchableTable>
	);
}
