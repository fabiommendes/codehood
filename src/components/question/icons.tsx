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
