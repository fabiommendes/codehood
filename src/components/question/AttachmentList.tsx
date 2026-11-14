import { For, type JSX, Show } from "solid-js";
import { m } from "@/i18n";

/// An attachment as a page receives it: a fenced block carries its `text`, a link only its name.
export interface AttachmentItem {
	name: string;
	format: string;
	text?: string;
	label?: string;
}

export interface AttachmentListProps {
	/// The attachments of a question or an exam; nothing renders when it is empty or absent.
	attachments: readonly AttachmentItem[] | undefined;
	/// The download URL of the attachment `name`, or null for a list without download links.
	url: (name: string) => string | null;
}

/**
 * The files a question or an exam gives to the student, one row each.
 *
 * A fenced attachment also shows its code in a block that starts closed.
 */
export function AttachmentList(props: AttachmentListProps): JSX.Element {
	return (
		<Show when={props.attachments && props.attachments.length > 0}>
			<section
				aria-label={m.common_attachments()}
				class="my-3 rounded-box border border-base-300 bg-base-200/50 p-3"
			>
				<p class="mb-2 text-xs font-semibold uppercase text-muted">
					{m.common_attachments()}
				</p>
				<ul class="flex flex-col gap-2">
					<For each={props.attachments}>
						{(item) => (
							<li class="flex flex-col gap-1">
								<div class="flex flex-wrap items-center gap-2 text-sm">
									<Show
										when={props.url(item.name)}
										fallback={<span class="font-medium">{item.name}</span>}
									>
										{(href) => (
											<a
												class="btn btn-sm btn-outline"
												href={href()}
												download={item.name}
											>
												<DownloadIcon />
												{item.name}
											</a>
										)}
									</Show>
									<span class="badge badge-ghost badge-sm">{item.format}</span>
									<Show when={item.label}>
										<span class="text-muted">{item.label}</span>
									</Show>
								</div>
								<Show when={item.text !== undefined}>
									<details class="rounded-box bg-base-100">
										<summary class="cursor-pointer px-3 py-1 text-xs text-muted">
											{m.common_attachment_show_code()}
										</summary>
										<pre class="overflow-x-auto p-3 text-xs">
											<code>{item.text}</code>
										</pre>
									</details>
								</Show>
							</li>
						)}
					</For>
				</ul>
			</section>
		</Show>
	);
}

/// Download arrow, decorative: the link's name is the file's.
function DownloadIcon(): JSX.Element {
	return (
		<svg
			viewBox="0 0 20 20"
			fill="currentColor"
			class="h-4 w-4 shrink-0"
			aria-hidden="true"
		>
			<path d="M10 3a.75.75 0 0 1 .75.75v7.69l2.22-2.22a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 1 1 1.06-1.06l2.22 2.22V3.75A.75.75 0 0 1 10 3ZM4.5 15a.75.75 0 0 1 .75.75v.5h9.5v-.5a.75.75 0 0 1 1.5 0v.5c0 .83-.67 1.5-1.5 1.5h-9.5c-.83 0-1.5-.67-1.5-1.5v-.5A.75.75 0 0 1 4.5 15Z" />
		</svg>
	);
}

export default AttachmentList;
