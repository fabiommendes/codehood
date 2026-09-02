import { actions } from "astro:actions";
import type { JSX } from "solid-js";
import Table, { type ColumnConfig } from "@/components/ui/Table";

export interface StudentRow {
	id: number;
	name: string;
	username: string;
	email: string;
	githubId: string;
	schoolId: string;
	enrolledAt: Date;
}

interface Props {
	students: StudentRow[];
	courseId: number;
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
 * the four admin tables (see dev/specs/to-do/course-navigation.md). The drop
 * control posts to the same `course.dropEnrollment` action a student's own
 * "Leave course" button uses, gated per-actor by `canDropEnrollment`.
 */
export default function StudentsTable(props: Props): JSX.Element {
	const columns: ColumnConfig<StudentRow>[] = [
		{ title: "Name", class: "font-medium", render: (row) => row.name },
		{
			title: "Username",
			class: "font-mono text-sm text-base-content/60",
			render: (row) => `@${row.username}`,
		},
		{
			title: "Email",
			class: "text-base-content/60",
			render: (row) => row.email,
		},
		{
			title: "GitHub",
			class: "font-mono text-sm text-base-content/60",
			render: (row) => row.githubId,
		},
		{
			title: "School ID",
			class: "font-mono text-sm text-base-content/60",
			render: (row) => row.schoolId,
		},
		{
			title: "Enrolled",
			class: "text-base-content/60",
			render: (row) => formatDate(row.enrolledAt),
		},
		{
			title: "Actions",
			class: "text-right",
			headerClass: "text-right",
			render: (row) => (
				<>
					<button
						type="button"
						class="btn btn-outline btn-error btn-sm"
						data-open-dialog={`drop-student-${row.id}`}
					>
						Drop
					</button>

					<dialog id={`drop-student-${row.id}`} class="modal">
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
								Drop {row.name} from this course?
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
								<input type="hidden" name="courseId" value={props.courseId} />
								<input type="hidden" name="userId" value={row.id} />
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
