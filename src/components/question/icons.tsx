import type { JSX } from "solid-js";

/** Small check mark, shared by the choice views to mark a correct choice. */
export function CheckIcon(): JSX.Element {
	return (
		<svg
			viewBox="0 0 20 20"
			fill="currentColor"
			class="h-5 w-5 shrink-0 text-success"
			aria-hidden="true"
		>
			<title>Correct</title>
			<path
				fill-rule="evenodd"
				d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-3.5-3.5a1 1 0 1 1 1.4-1.4l2.8 2.8 6.8-6.8a1 1 0 0 1 1.4 0Z"
				clip-rule="evenodd"
			/>
		</svg>
	);
}

/** Paper-plane mark, for a control that submits an answer. */
export function SubmitIcon(): JSX.Element {
	return (
		<svg
			viewBox="0 0 20 20"
			fill="currentColor"
			class="h-5 w-5 shrink-0"
			aria-hidden="true"
		>
			<title>Submit</title>
			<path d="M2.94 2.47a.75.75 0 0 1 .81-.17l14 5.5a.75.75 0 0 1 0 1.4l-14 5.5a.75.75 0 0 1-1-.87l1.2-5.13-1.2-5.13a.75.75 0 0 1 .19-1.1Z" />
		</svg>
	);
}

/** Counter-clockwise arrow, for a control that clears a submitted answer. */
export function ResetIcon(): JSX.Element {
	return (
		<svg
			viewBox="0 0 20 20"
			fill="currentColor"
			class="h-5 w-5 shrink-0"
			aria-hidden="true"
		>
			<title>Reset</title>
			<path
				fill-rule="evenodd"
				d="M10 4.5a5.5 5.5 0 1 0 5.29 7h1.55a7 7 0 1 1-1.8-6.86l.71-.71a.75.75 0 0 1 1.28.53V8a.75.75 0 0 1-.75.75h-3.46a.75.75 0 0 1-.53-1.28l1.02-1.02A5.48 5.48 0 0 0 10 4.5Z"
				clip-rule="evenodd"
			/>
		</svg>
	);
}

/**
 * Upward arrow in a circle, for a control that publishes a question. Unlike
 * the other icons here, it carries no `<title>` of its own — the button
 * wrapping it supplies the `aria-label`/`title` naming the action.
 */
export function PublishIcon(): JSX.Element {
	return (
		<svg
			viewBox="0 0 20 20"
			fill="currentColor"
			class="h-5 w-5 shrink-0"
			aria-hidden="true"
		>
			<path
				fill-rule="evenodd"
				d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-11.44 3.5 3.5a.75.75 0 1 1-1.06 1.06l-2.22-2.22V13a.75.75 0 0 1-1.5 0V8.9L7.25 11.12a.75.75 0 1 1-1.06-1.06l3.5-3.5a.75.75 0 0 1 1.06 0Z"
				clip-rule="evenodd"
			/>
		</svg>
	);
}

/// Box with a lid, for a control that archives a question. No `<title>`, for
/// the same reason as `PublishIcon`.
export function ArchiveIcon(): JSX.Element {
	return (
		<svg
			viewBox="0 0 20 20"
			fill="currentColor"
			class="h-5 w-5 shrink-0"
			aria-hidden="true"
		>
			<path d="M3.75 3A1.75 1.75 0 0 0 2 4.75v.5C2 6.216 2.784 7 3.75 7h12.5A1.75 1.75 0 0 0 18 5.25v-.5A1.75 1.75 0 0 0 16.25 3H3.75Z" />
			<path
				fill-rule="evenodd"
				d="M3.5 8.5A.75.75 0 0 1 4.25 8h11.5a.75.75 0 0 1 .75.75v6.5A1.75 1.75 0 0 1 14.75 17H5.25A1.75 1.75 0 0 1 3.5 15.25v-6.5Zm5 2.5a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 0 1.5h-1.5a.75.75 0 0 1-.75-.75Z"
				clip-rule="evenodd"
			/>
		</svg>
	);
}

/// Pencil over a sheet, for a control that moves an archived question back to
/// draft. No `<title>`, for the same reason as `PublishIcon`.
export function DraftIcon(): JSX.Element {
	return (
		<svg
			viewBox="0 0 20 20"
			fill="currentColor"
			class="h-5 w-5 shrink-0"
			aria-hidden="true"
		>
			<path d="m5.433 13.917 1.262-3.155A4 4 0 0 1 7.58 9.42l6.92-6.918a2.121 2.121 0 0 1 3 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 0 1-.65-.65Z" />
			<path d="M3.5 5.75c0-.966.784-1.75 1.75-1.75H10a.75.75 0 0 1 0 1.5H5.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V10a.75.75 0 0 1 1.5 0v5.25a1.75 1.75 0 0 1-1.75 1.75h-9.5a1.75 1.75 0 0 1-1.75-1.75v-9.5Z" />
		</svg>
	);
}

/** Right-pointing arrow, for a control that navigates to a question's page. */
export function GoIcon(): JSX.Element {
	return (
		<svg
			viewBox="0 0 20 20"
			fill="currentColor"
			class="h-5 w-5 shrink-0"
			aria-hidden="true"
		>
			<path
				fill-rule="evenodd"
				d="M8.22 4.22a.75.75 0 0 1 1.06 0l5 5a.75.75 0 0 1 0 1.06l-5 5a.75.75 0 1 1-1.06-1.06L12.44 10 8.22 5.78a.75.75 0 0 1 0-1.06Z"
				clip-rule="evenodd"
			/>
		</svg>
	);
}

/** Small x mark, shared by the choice views to mark an incorrect choice. */
export function XIcon(): JSX.Element {
	return (
		<svg
			viewBox="0 0 20 20"
			fill="currentColor"
			class="h-5 w-5 shrink-0 text-error"
			aria-hidden="true"
		>
			<title>Incorrect</title>
			<path
				fill-rule="evenodd"
				d="M5.3 5.3a1 1 0 0 1 1.4 0L10 8.6l3.3-3.3a1 1 0 1 1 1.4 1.4L11.4 10l3.3 3.3a1 1 0 0 1-1.4 1.4L10 11.4l-3.3 3.3a1 1 0 0 1-1.4-1.4L8.6 10 5.3 6.7a1 1 0 0 1 0-1.4Z"
				clip-rule="evenodd"
			/>
		</svg>
	);
}
