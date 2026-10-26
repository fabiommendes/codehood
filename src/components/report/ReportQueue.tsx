import { actions } from "astro:actions";
import { createSignal, For, type JSX, onCleanup, Show } from "solid-js";
import {
	type ReportKind,
	type ReportStatus,
	reportKind,
	reportStatus,
} from "@/core/schemas";
import { errorMessage } from "@/forms/field-errors";
import { m } from "@/i18n";
import {
	REPORT_KIND_LABELS,
	REPORT_STATUS_LABELS,
	type ReportRow,
} from "@/utils/report-row";

export interface ReportQueueProps {
	reports: ReportRow[];
	/// The filters the list was loaded with; a report that stops matching them leaves the list.
	status: ReportStatus | null;
	kind: ReportKind | null;
}

/// How long the "Report updated." toast stays.
const TOAST_MS = 5000;

/// How the date of a report is shown.
function formatDate(iso: string): string {
	return new Date(iso).toLocaleString();
}

/**
 * The triage queue: each report with its context and images, and a form to
 * change its status, type and note.
 *
 * Shared by the admin queue and a course's content reports.
 */
export default function ReportQueue(props: ReportQueueProps): JSX.Element {
	const [rows, setRows] = createSignal(props.reports);
	const [toast, setToast] = createSignal<string | undefined>();
	let toastTimer: ReturnType<typeof setTimeout> | undefined;
	onCleanup(() => clearTimeout(toastTimer));

	/// Whether `row` still belongs in the list the filters ask for.
	const matches = (row: ReportRow): boolean =>
		(props.status === null || row.status === props.status) &&
		(props.kind === null || row.kind === props.kind);

	function saved(updated: ReportRow): void {
		setRows(
			rows()
				.map((row) => (row.publicId === updated.publicId ? updated : row))
				.filter(matches),
		);
		setToast(m.report_updated());
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => setToast(undefined), TOAST_MS);
	}

	return (
		<>
			<Show
				when={rows().length > 0}
				fallback={
					<p class="rounded-box border border-dashed border-base-300 p-8 text-center text-base-content/60">
						{m.report_queue_empty()}
					</p>
				}
			>
				<div class="flex flex-col gap-4">
					<For each={rows()}>
						{(row) => <ReportCard row={row} onSaved={saved} />}
					</For>
				</div>
			</Show>

			<Show when={toast()}>
				<div class="toast toast-end toast-bottom z-50">
					<div role="status" class="alert alert-success max-w-sm text-sm">
						<span>{toast()}</span>
					</div>
				</div>
			</Show>
		</>
	);
}

/// One report of the queue with its triage form.
function ReportCard(props: {
	row: ReportRow;
	onSaved: (row: ReportRow) => void;
}): JSX.Element {
	const id = `report-${props.row.publicId}`;
	const [status, setStatus] = createSignal<ReportStatus>(props.row.status);
	const [kind, setKind] = createSignal<ReportKind>(props.row.kind);
	const [note, setNote] = createSignal(props.row.note ?? "");
	const [error, setError] = createSignal<string | undefined>();
	const [busy, setBusy] = createSignal(false);

	async function save(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		setBusy(true);
		setError(undefined);
		const trimmed = note().trim();
		const { error: failure } = await actions.report.triage({
			publicId: props.row.publicId,
			status: status(),
			kind: kind(),
			note: trimmed === "" ? null : trimmed,
		});
		setBusy(false);
		if (failure) {
			setError(errorMessage(failure));
			return;
		}
		props.onSaved({
			...props.row,
			status: status(),
			kind: kind(),
			note: trimmed === "" ? null : trimmed,
		});
	}

	return (
		<article class="card card-border bg-base-100">
			<div class="card-body gap-3">
				<header class="flex flex-wrap items-center gap-2 text-sm">
					<span class="badge badge-outline">
						{REPORT_KIND_LABELS[props.row.kind]()}
					</span>
					<span class="badge badge-neutral">
						{REPORT_STATUS_LABELS[props.row.status]()}
					</span>
					<span class="text-base-content/60">
						{formatDate(props.row.createdAt)}
					</span>
				</header>

				<p class="whitespace-pre-wrap">{props.row.message}</p>

				<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm text-base-content/70">
					<dt>{m.report_field_author()}</dt>
					<dd class="font-mono">{props.row.author}</dd>
					<Show when={props.row.course}>
						<dt>{m.report_field_course()}</dt>
						<dd>{props.row.course}</dd>
					</Show>
					<Show when={props.row.url}>
						<dt>{m.report_field_url()}</dt>
						<dd class="break-all">{props.row.url}</dd>
					</Show>
					<Show when={props.row.viewport}>
						<dt>{m.report_field_viewport()}</dt>
						<dd class="font-mono">{props.row.viewport}</dd>
					</Show>
				</dl>

				<Show when={props.row.attachments.length > 0}>
					<ul class="flex flex-wrap gap-3">
						<For each={props.row.attachments}>
							{(attachment) => (
								<li>
									<a href={attachment.url} target="_blank" rel="noreferrer">
										<img
											src={attachment.url}
											alt={attachment.filename}
											class="max-h-32 rounded-box border border-base-300"
										/>
									</a>
								</li>
							)}
						</For>
					</ul>
				</Show>

				<form class="flex flex-col gap-3" onSubmit={save}>
					<Show when={error()}>
						<div role="alert" class="alert alert-error text-sm">
							<span>{error()}</span>
						</div>
					</Show>
					<div class="flex flex-wrap gap-3">
						<fieldset class="fieldset">
							<legend class="fieldset-legend">
								<label for={`${id}-status`}>{m.report_label_status()}</label>
							</legend>
							<select
								id={`${id}-status`}
								class="select"
								onChange={(event) =>
									setStatus(reportStatus.parse(event.currentTarget.value))
								}
							>
								<For each={reportStatus.options}>
									{(option) => (
										<option value={option} selected={option === status()}>
											{REPORT_STATUS_LABELS[option]()}
										</option>
									)}
								</For>
							</select>
						</fieldset>
						<fieldset class="fieldset">
							<legend class="fieldset-legend">
								<label for={`${id}-kind`}>{m.report_label_type()}</label>
							</legend>
							<select
								id={`${id}-kind`}
								class="select"
								onChange={(event) =>
									setKind(reportKind.parse(event.currentTarget.value))
								}
							>
								<For
									each={reportKind.options.filter(
										(option) =>
											option !== "CONTENT" || props.row.course !== null,
									)}
								>
									{(option) => (
										<option value={option} selected={option === kind()}>
											{REPORT_KIND_LABELS[option]()}
										</option>
									)}
								</For>
							</select>
						</fieldset>
					</div>
					<fieldset class="fieldset">
						<legend class="fieldset-legend">
							<label for={`${id}-note`}>{m.report_label_note()}</label>
						</legend>
						<textarea
							id={`${id}-note`}
							class="textarea w-full"
							rows="2"
							onInput={(event) => setNote(event.currentTarget.value)}
						>
							{props.row.note ?? ""}
						</textarea>
					</fieldset>
					<div>
						<button
							type="submit"
							class="btn btn-primary btn-sm"
							disabled={busy()}
						>
							{m.report_save()}
						</button>
					</div>
				</form>
			</div>
		</article>
	);
}
