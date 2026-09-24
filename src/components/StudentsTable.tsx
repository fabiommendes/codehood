import { actions } from "astro:actions";
import type { JSX } from "solid-js";
import type { z } from "zod";
import Table, { type ColumnConfig } from "@/components/ui/Table";
import type { enrollmentSchema } from "@/core/schemas";

/// The columns this table renders — the full `enrollmentSchema` row minus the
/// course's raw database id, which never reaches the browser.
type EnrolledUser = Omit<z.infer<typeof enrollmentSchema>, "courseId">;

interface Props {
	students: EnrolledUser[];
	/// The course's URL segments, e.g. `discipline: "cs101"`, `course: "ada_2026-1"`.
	discipline: string;
	course: string;
}

function formatDate(date: Date): string {
	return date.toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

/**
 * The Students tab's table — the fifth caller of `ui/Table.tsx`, alongside
 * the four admin tables. The drop control posts to the same
 * `course.dropEnrollment` action a student's own "Leave course" button uses,
 * gated per-actor by `enrollment.delete`.
 */
export default function StudentsTable(props: Props): JSX.Element {
	const columns: ColumnConfig<EnrolledUser>[] = [
		{ title: "Name", class: "font-medium", render: (user) => user.name },
		{
			title: "Username",
			class: "font-mono text-sm text-base-content/60",
			render: (user) => `@${user.username}`,
		},
		{
			title: "Email",
			class: "text-base-content/60",
			render: (user) => user.email,
		},
		{
			title: "GitHub",
			class: "font-mono text-sm text-base-content/60",
			render: (user) => user.githubId,
		},
		{
			title: "School ID",
			class: "font-mono text-sm text-base-content/60",
			render: (user) => user.schoolId,
		},
		{
			title: "Enrolled",
			class: "text-base-content/60",
			render: (user) => formatDate(user.enrolledAt),
		},
		{
			title: "Actions",
			class: "text-right",
			headerClass: "text-right",
			render: (user) => (
				<>
					<button
						type="button"
						class="btn btn-outline btn-error btn-sm"
						data-open-dialog={`drop-student-${user.username}`}
					>
						Drop
					</button>

					<dialog id={`drop-student-${user.username}`} class="modal">
						<div class="modal-box">
							<form method="dialog">
								<button
									class="btn btn-circle btn-ghost btn-sm absolute right-2 top-2"
									type="button"
								>
									✕
								</button>
							</form>
							<h3 class="text-lg font-bold">
								Drop {user.name} from this course?
							</h3>
							<p class="mt-2 text-sm text-base-content/70">
								Their access ends immediately. Nothing is deleted — their
								submissions stay in the gradebook, and re-enrolling restores
								access.
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
									Cancel
								</button>
								<button type="submit" class="btn btn-error">
									Drop
								</button>
							</form>
						</div>
						<form method="dialog" class="modal-backdrop">
							<button type="button">close</button>
						</form>
					</dialog>
				</>
			),
		},
	];

	return <Table columns={columns} data={props.students} class="mt-4" />;
}
