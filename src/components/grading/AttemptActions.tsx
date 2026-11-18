import { createMemo, createSignal, type JSX, Show } from "solid-js";
import { m } from "@/i18n";
import { adjustTotal, formatScore } from "@/services/exam-result";
import type { RosterRow, RosterStatus } from "@/services/grading";
import AdjustmentDialog, { type AdjustmentPreview } from "./AdjustmentDialog";
import Dialog from "./Dialog";
import Icon from "./Icon";
import SortTable from "./SortTable";

interface Props {
	/// The course's URL segments and the exam slug, as the adjustment action takes them.
	discipline: string;
	course: string;
	exam: string;
	/// The username of the student on display.
	author: string;
	/// The attempt's total before the adjustments of the exam, or `null` while an answer is pending.
	base: number | null;
	/// The active adjustments of the whole exam on this attempt.
	adjustments: readonly { op: "SET" | "FACTOR" | "OFFSET"; value: string }[];
	/// Every active student of the exam.
	roster: readonly RosterRow[];
	/// The exam's attempts URL; a student's page is this followed by `/<username>`.
	attemptHref: string;
	/// Whether the exam takes adjustments at all; a practice exam does not.
	adjustable: boolean;
}

/// The badge of each situation in the student list.
const STATUS_BADGE: Record<RosterStatus, string> = {
	submitted: "badge-success",
	pending: "badge-warning",
	"in-progress": "badge-info",
	none: "badge-neutral",
	adjusted: "border-yellow-200 bg-yellow-50 text-yellow-800",
};

/// The situations from the one that needs attention first.
const STATUS_ORDER: RosterStatus[] = [
	"pending",
	"in-progress",
	"none",
	"adjusted",
	"submitted",
];

/// The text of a situation.
function statusLabel(status: RosterStatus): string {
	switch (status) {
		case "none":
			return m.grades_adjustment_status_none();
		case "in-progress":
			return m.grades_adjustment_status_in_progress();
		case "pending":
			return m.grades_adjustment_status_pending();
		case "adjusted":
			return m.grades_adjustment_status_adjusted();
		case "submitted":
			return m.grades_adjustment_status_submitted();
	}
}

type DialogName = "sanction" | "bonus" | "students";

/**
 * The three icon buttons beside the student's name, "Sanction", "Add bonus" and "Student list", and the dialogs they open.
 */
export default function AttemptActions(props: Props): JSX.Element {
	const [open, setOpen] = createSignal<DialogName | null>(null);
	const [query, setQuery] = createSignal("");
	const close = () => setOpen(null);

	const rows = createMemo(() => {
		const text = query().trim().toLowerCase();
		return props.roster.filter(
			(row) =>
				!text ||
				row.name.toLowerCase().includes(text) ||
				row.username.toLowerCase().includes(text) ||
				(row.schoolId?.toLowerCase().includes(text) ?? false),
		);
	});

	/// The total now, and the total with the change the dialog is about to make.
	const preview: AdjustmentPreview = ({ op, fraction }) => ({
		from: adjustTotal(props.base, props.adjustments),
		to: adjustTotal(props.base, [
			...props.adjustments,
			{ op, value: fraction },
		]),
	});

	const iconButton = "btn btn-ghost btn-sm btn-square";
	const dialogProps = () => ({
		discipline: props.discipline,
		course: props.course,
		exam: props.exam,
		usernames: [props.author],
		preview,
		open: false,
		onClose: close,
	});
	return (
		<>
			<div class="flex items-center gap-1">
				<Show when={props.adjustable}>
					<button
						type="button"
						class={`${iconButton} text-error`}
						aria-label={m.grades_adjustment_sanction()}
						title={m.grades_adjustment_sanction()}
						onClick={() => setOpen("sanction")}
					>
						<Icon name="gavel" />
					</button>
					<button
						type="button"
						class={`${iconButton} text-success`}
						aria-label={m.grades_adjustment_bonus()}
						title={m.grades_adjustment_bonus()}
						onClick={() => setOpen("bonus")}
					>
						<Icon name="badgePlus" />
					</button>
				</Show>
				<button
					type="button"
					class={iconButton}
					aria-label={m.grades_adjustment_student_list()}
					title={m.grades_adjustment_student_list()}
					onClick={() => setOpen("students")}
				>
					<Icon name="users" />
				</button>
			</div>

			<Dialog
				id="students-dialog"
				title={m.grades_adjustment_roster_title()}
				open={open() === "students"}
				onClose={close}
			>
				<label class="input input-sm w-full">
					<input
						type="search"
						placeholder={m.grades_adjustment_roster_search()}
						aria-label={m.grades_adjustment_roster_label()}
						value={query()}
						onInput={(event) => setQuery(event.currentTarget.value)}
					/>
				</label>
				<p class="mt-2 text-xs text-muted">
					{m.grades_adjustment_roster_count({
						shown: rows().length,
						total: props.roster.length,
					})}
				</p>
				<div class="mt-2 max-h-96 overflow-y-auto rounded-box border border-edge">
					<SortTable
						label={m.grades_adjustment_roster_title()}
						data={rows()}
						rowClass={(row) =>
							row.username === props.author ? "bg-base-200" : undefined
						}
						columns={[
							{
								title: m.grades_adjustment_roster_col_name(),
								sortKey: "name",
								sortValue: (row) => row.name,
								render: (row) => (
									<a
										class="link link-hover font-medium"
										href={`${props.attemptHref}/${row.username}`}
									>
										{row.name}
									</a>
								),
							},
							{
								title: m.grades_adjustment_roster_col_registration(),
								sortKey: "schoolId",
								sortValue: (row) => row.schoolId,
								render: (row) => (
									<span class="font-mono text-xs tabular-nums">
										{row.schoolId ?? "—"}
									</span>
								),
							},
							{
								title: m.grades_adjustment_roster_col_username(),
								sortKey: "username",
								sortValue: (row) => row.username,
								render: (row) => (
									<span class="font-mono text-xs text-muted">
										{row.username}
									</span>
								),
							},
							{
								title: m.grades_adjustment_roster_col_total(),
								sortKey: "total",
								sortValue: (row) => row.total,
								class: "tabular-nums",
								render: (row) =>
									row.total === null ? "—" : formatScore(row.total),
							},
							{
								title: m.grades_adjustment_roster_col_status(),
								sortKey: "status",
								sortValue: (row) => STATUS_ORDER.indexOf(row.status),
								render: (row) => (
									<span
										class={`badge badge-soft badge-sm ${STATUS_BADGE[row.status]}`}
									>
										{statusLabel(row.status)}
									</span>
								),
							},
						]}
					/>
				</div>
			</Dialog>

			<Show when={props.adjustable}>
				<AdjustmentDialog
					{...dialogProps()}
					id="bonus-dialog"
					open={open() === "bonus"}
					kind="bonus"
					title={m.grades_adjustment_bonus()}
					submitLabel={m.grades_adjustment_bonus()}
				/>
				<AdjustmentDialog
					{...dialogProps()}
					id="sanction-dialog"
					open={open() === "sanction"}
					kind="sanction"
					title={m.grades_adjustment_sanction()}
					submitLabel={m.grades_adjustment_sanction()}
				/>
			</Show>
		</>
	);
}
