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
