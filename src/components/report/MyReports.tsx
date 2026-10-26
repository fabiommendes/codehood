import { actions } from "astro:actions";
import { createSignal, For, type JSX, Show } from "solid-js";
import { errorMessage } from "@/forms/field-errors";
import { m } from "@/i18n";
import {
	REPORT_KIND_LABELS,
	REPORT_STATUS_LABELS,
	type ReportRow,
} from "@/utils/report-row";

export interface MyReportsProps {
	reports: ReportRow[];
}

/// How many characters of the message the closed report shows.
const PREVIEW_CHARS = 80;

/// The start of `message`, cut at `PREVIEW_CHARS`.
function preview(message: string): string {
	const text = message.replace(/\s+/g, " ").trim();
	return text.length > PREVIEW_CHARS
		? `${text.slice(0, PREVIEW_CHARS).trimEnd()}…`
		: text;
}

/**
 * The reports the user sent: type, date and status, with the text and images
 * of each one on demand, and a way to take back one that is still open.
 */
export default function MyReports(props: MyReportsProps): JSX.Element {
	const [rows, setRows] = createSignal(props.reports);
	const [error, setError] = createSignal<string | undefined>();

	async function remove(row: ReportRow): Promise<void> {
		setError(undefined);
		const { error: failure } = await actions.report.delete({
			publicId: row.publicId,
		});
		if (failure) {
			setError(errorMessage(failure));
			return;
		}
		setRows(rows().filter((other) => other.publicId !== row.publicId));
	}

	return (
		<Show
			when={rows().length > 0}
			fallback={
				<p class="rounded-box border border-dashed border-base-300 p-8 text-center text-base-content/60">
					{m.report_mine_empty()}
				</p>
			}
		>
			<Show when={error()}>
				<div role="alert" class="alert alert-error mb-4 text-sm">
					<span>{error()}</span>
				</div>
			</Show>
			<div class="flex flex-col gap-3">
				<For each={rows()}>
					{(row) => <MyReport row={row} onDelete={remove} />}
				</For>
			</div>
		</Show>
	);
}

/// One report of the user, closed until its button is pressed.
function MyReport(props: {
	row: ReportRow;
	onDelete: (row: ReportRow) => Promise<void>;
}): JSX.Element {
	const [open, setOpen] = createSignal(false);
	const bodyId = `my-report-${props.row.publicId}`;

	return (
		<article class="card card-border bg-base-100">
			<div class="card-body gap-2 p-4">
				<header class="flex flex-wrap items-center gap-2 text-sm">
					<span class="badge badge-outline">
						{REPORT_KIND_LABELS[props.row.kind]()}
					</span>
					<span class="badge badge-neutral">
						{REPORT_STATUS_LABELS[props.row.status]()}
					</span>
					<span class="text-base-content/60">
						{new Date(props.row.createdAt).toLocaleDateString()}
					</span>
				</header>
				<button
					type="button"
					class="text-left hover:underline"
					aria-expanded={open()}
					aria-controls={bodyId}
					onClick={() => setOpen(!open())}
				>
					<Show when={open()} fallback={preview(props.row.message)}>
						<span class="whitespace-pre-wrap">{props.row.message}</span>
					</Show>
				</button>
				<Show when={open()}>
					<div id={bodyId} class="flex flex-col gap-3">
						<Show when={props.row.attachments.length > 0}>
							<ul class="flex flex-wrap gap-3">
								<For each={props.row.attachments}>
									{(attachment) => (
										<li>
											<img
												src={attachment.url}
												alt={attachment.filename}
												class="max-h-32 rounded-box border border-base-300"
											/>
										</li>
									)}
								</For>
							</ul>
						</Show>
					</div>
				</Show>
				<Show when={props.row.status === "OPEN"}>
					<div>
						<button
							type="button"
							class="btn btn-outline btn-error btn-sm"
							onClick={() => props.onDelete(props.row)}
						>
							{m.report_delete()}
						</button>
					</div>
				</Show>
			</div>
		</article>
	);
}
