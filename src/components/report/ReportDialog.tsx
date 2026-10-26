import { actions } from "astro:actions";
import {
	createSignal,
	For,
	type JSX,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import {
	REPORT_MAX_ATTACHMENT_BYTES,
	REPORT_MAX_ATTACHMENTS,
	type ReportKind,
	reportKind,
	reportMessage,
} from "@/core/schemas";
import { fieldErrors } from "@/forms/field-errors";
import { m } from "@/i18n";
import { REPORT_KIND_LABELS } from "@/utils/report-row";

/// What an opener (an element with `data-report-open`) may ask for through its `data-report-kind` and `data-report-url`.
interface OpenReportDetail {
	/// The type to preselect, instead of the page's default.
	kind?: ReportKind;
	/// The page the report is about, instead of the current one.
	url?: string;
}

export interface ReportDialogProps {
	/// The course of the page, as the URL segments the actions take; `null` outside a course.
	course: { discipline: string; course: string } | null;
	/// Whether the page is about a course's content (a question, an exam or a material).
	contentPage: boolean;
	/// Renders the dialog's box in place, in one of its states, instead of the modal; for the design pages.
	preview?: "empty" | "capture" | "sending" | "error";
}

/// A one-pixel picture standing for a capture in the design pages.
const PREVIEW_PIXEL =
	"data:image/gif;base64,R0lGODlhAQABAIAAAMLCwgAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==";

/// An image the user added or the page captured, with the URL of its preview.
interface Picture {
	file: File;
	url: string;
}

/// How long the "Report sent." toast stays.
const TOAST_MS = 5000;

/// Takes a WebP picture of the visible page, or `null` when it cannot be taken or is too large to send.
async function captureScreenshot(): Promise<File | null> {
	try {
		const { domToBlob } = await import("modern-screenshot");
		const blob = await domToBlob(document.documentElement, {
			type: "image/webp",
			quality: 0.8,
			width: window.innerWidth,
			height: window.innerHeight,
		});
		if (!blob || blob.size > REPORT_MAX_ATTACHMENT_BYTES) return null;
		return new File([blob], "screenshot.webp", { type: "image/webp" });
	} catch {
		return null;
	}
}

/// Wraps `file` with a preview URL.
function picture(file: File): Picture {
	return { file, url: URL.createObjectURL(file) };
}

/**
 * The "Report a problem" dialog.
 *
 * Any element with `data-report-open` opens it. The page is captured first
 * and the dialog opens after, so it does not show in the picture. The report
 * goes through the `report.create` action with the page's context.
 */
export default function ReportDialog(props: ReportDialogProps): JSX.Element {
	let dialog: HTMLDialogElement | undefined;
	const id = props.preview ? `report-${props.preview}` : "report";
	let fileInput: HTMLInputElement | undefined;
	let toastTimer: ReturnType<typeof setTimeout> | undefined;

	const [kind, setKind] = createSignal<ReportKind>("BUG");
	const [message, setMessage] = createSignal(
		props.preview === "error" ? "Too short" : "",
	);
	const previewing = props.preview !== undefined;
	const [screenshot, setScreenshot] = createSignal<Picture | null>(
		props.preview === "capture" || props.preview === "sending"
			? { file: new File([], "screenshot.webp"), url: PREVIEW_PIXEL }
			: null,
	);
	const [extras, setExtras] = createSignal<Picture[]>([]);
	const [pageUrl, setPageUrl] = createSignal("");
	const [warning, setWarning] = createSignal<string | undefined>(
		props.preview === "error" ? m.report_capture_failed() : undefined,
	);
	const [messageError, setMessageError] = createSignal<string | undefined>(
		props.preview === "error"
			? m.forms_schema_report_message_min({ min: 10 })
			: undefined,
	);
	const [imageError, setImageError] = createSignal<string | undefined>();
	const [formError, setFormError] = createSignal<string | undefined>();
	const [busy, setBusy] = createSignal(props.preview === "sending");
	const [toast, setToast] = createSignal<string | undefined>();

	const imageCount = () => (screenshot() ? 1 : 0) + extras().length;

	/// Drops the preview URLs and everything typed.
	function reset(): void {
		const pictures = [screenshot(), ...extras()];
		for (const item of pictures) if (item) URL.revokeObjectURL(item.url);
		setScreenshot(null);
		setExtras([]);
		setMessage("");
		setWarning(undefined);
		setMessageError(undefined);
		setImageError(undefined);
		setFormError(undefined);
	}

	async function open(detail: OpenReportDetail): Promise<void> {
		if (busy()) return;
		reset();
		const defaultKind = props.contentPage && props.course ? "CONTENT" : "BUG";
		setKind(detail.kind ?? defaultKind);
		setPageUrl(detail.url ?? window.location.href);
		const file = await captureScreenshot();
		if (file) setScreenshot(picture(file));
		else setWarning(m.report_capture_failed());
		dialog?.showModal();
	}

	/// Opens the dialog for a click on an opener, closing the menu it may sit in first.
	function onClick(event: MouseEvent): void {
		const opener = (event.target as Element).closest<HTMLElement>(
			"[data-report-open]",
		);
		if (!opener) return;
		opener.closest("details")?.removeAttribute("open");
		const requested = reportKind.safeParse(opener.dataset.reportKind);
		void open({
			kind: requested.success ? requested.data : undefined,
			url: opener.dataset.reportUrl,
		});
	}

	onMount(() => document.addEventListener("click", onClick));
	onCleanup(() => {
		// Cleanups also run when the island is rendered on the server.
		if (typeof document !== "undefined") {
			document.removeEventListener("click", onClick);
		}
		clearTimeout(toastTimer);
	});

	function addFiles(files: FileList | null): void {
		setImageError(undefined);
		const added: Picture[] = [];
		for (const file of Array.from(files ?? [])) {
			if (file.size > REPORT_MAX_ATTACHMENT_BYTES) {
				setImageError(m.report_image_too_large({ name: file.name }));
			} else if (imageCount() + added.length >= REPORT_MAX_ATTACHMENTS) {
				setImageError(
					m.report_too_many_images({ max: REPORT_MAX_ATTACHMENTS }),
				);
			} else {
				added.push(picture(file));
			}
		}
		setExtras([...extras(), ...added]);
		if (fileInput) fileInput.value = "";
	}

	function removeExtra(item: Picture): void {
		URL.revokeObjectURL(item.url);
		setExtras(extras().filter((other) => other !== item));
		setImageError(undefined);
	}

	function removeScreenshot(): void {
		const item = screenshot();
		if (item) URL.revokeObjectURL(item.url);
		setScreenshot(null);
		setImageError(undefined);
	}

	async function submit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		setFormError(undefined);
		const parsed = reportMessage.safeParse(message());
		if (!parsed.success) {
			setMessageError(parsed.error.issues[0]?.message);
			return;
		}
		setMessageError(undefined);

		const data = new FormData();
		data.set("kind", kind());
		data.set("message", message());
		data.set("url", pageUrl());
		data.set("userAgent", navigator.userAgent);
		data.set("viewport", `${window.innerWidth}x${window.innerHeight}`);
		if (props.course) {
			data.set("discipline", props.course.discipline);
			data.set("course", props.course.course);
		}
		for (const item of [screenshot(), ...extras()]) {
			if (item) data.append("images", item.file);
		}

		setBusy(true);
		const { error } = await actions.report.create(data);
		setBusy(false);
		if (error) {
			const { fields, message: general } = fieldErrors(error);
			setMessageError(fields.message?.join(" "));
			setImageError(fields.images?.join(" "));
			setFormError(
				[general, ...(fields.kind ?? [])].filter(Boolean).join(" ") ||
					undefined,
			);
			return;
		}
		reset();
		dialog?.close();
		setToast(m.report_sent());
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => setToast(undefined), TOAST_MS);
	}

	const box = (
		<div class="modal-box">
			<h3 id={`${id}-title`} class="text-lg font-bold">
				{m.report_title()}
			</h3>
			<form noValidate class="mt-4 flex flex-col gap-3" onSubmit={submit}>
				<Show when={warning()}>
					<div role="alert" class="alert alert-warning text-sm">
						<span>{warning()}</span>
					</div>
				</Show>
				<Show when={formError()}>
					<div role="alert" class="alert alert-error text-sm">
						<span>{formError()}</span>
					</div>
				</Show>

				<Show when={screenshot()}>
					{(item) => (
						<div class="flex items-start gap-3">
							<img
								src={item().url}
								alt={m.report_screenshot_alt()}
								class="max-h-40 rounded-box border border-base-300"
							/>
							<button
								type="button"
								class="btn btn-ghost btn-sm"
								onClick={removeScreenshot}
							>
								{m.report_remove_screenshot()}
							</button>
						</div>
					)}
				</Show>

				<fieldset class="fieldset">
					<legend class="fieldset-legend">
						<label for={`${id}-kind`}>{m.report_label_type()}</label>
					</legend>
					<select
						id={`${id}-kind`}
						class="select w-full"
						value={kind()}
						onChange={(event) =>
							setKind(reportKind.parse(event.currentTarget.value))
						}
					>
						<For
							each={reportKind.options.filter(
								(option) => option !== "CONTENT" || props.course,
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

				<fieldset class="fieldset">
					<legend class="fieldset-legend">
						<label for={`${id}-message`}>{m.report_label_message()}</label>
					</legend>
					<textarea
						id={`${id}-message`}
						class="textarea w-full"
						classList={{ "textarea-error": !!messageError() }}
						rows="5"
						value={message()}
						aria-invalid={messageError() ? "true" : undefined}
						onInput={(event) => setMessage(event.currentTarget.value)}
					/>
					<Show when={messageError()}>
						<p class="label whitespace-normal text-error">{messageError()}</p>
					</Show>
				</fieldset>

				<fieldset class="fieldset">
					<legend class="fieldset-legend">
						<label for={`${id}-images`}>{m.report_label_images()}</label>
					</legend>
					<input
						ref={fileInput}
						id={`${id}-images`}
						type="file"
						multiple
						accept="image/png,image/jpeg,image/webp"
						class="file-input w-full"
						onChange={(event) => addFiles(event.currentTarget.files)}
					/>
					<Show when={imageError()}>
						<p class="label whitespace-normal text-error">{imageError()}</p>
					</Show>
				</fieldset>

				<Show when={extras().length > 0}>
					<ul class="flex flex-wrap gap-3">
						<For each={extras()}>
							{(item) => (
								<li class="flex flex-col items-start gap-1">
									<img
										src={item.url}
										alt={item.file.name}
										class="max-h-24 rounded-box border border-base-300"
									/>
									<button
										type="button"
										class="btn btn-ghost btn-xs"
										onClick={() => removeExtra(item)}
									>
										{m.report_remove_image({ name: item.file.name })}
									</button>
								</li>
							)}
						</For>
					</ul>
				</Show>

				<div class="modal-action">
					<button
						type="button"
						class="btn btn-ghost"
						disabled={busy()}
						onClick={() => dialog?.close()}
					>
						{m.report_cancel()}
					</button>
					<button type="submit" class="btn btn-primary" disabled={busy()}>
						{busy() ? m.report_sending() : m.report_send()}
					</button>
				</div>
			</form>
		</div>
	);

	return (
		<>
			<Show
				when={!previewing}
				fallback={<div class="w-full max-w-lg">{box}</div>}
			>
				<dialog ref={dialog} class="modal" aria-labelledby={`${id}-title`}>
					{box}
					<form method="dialog" class="modal-backdrop">
						<button type="submit">{m.report_close_backdrop()}</button>
					</form>
				</dialog>
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
