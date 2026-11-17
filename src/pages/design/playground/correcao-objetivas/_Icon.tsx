import type { JSX } from "solid-js";
import { ICONS, type IconName } from "./_icons";

/// A decorative stroke icon; the button around it carries the accessible name.
export default function Icon(props: { name: IconName }): JSX.Element {
	return (
		<svg
			viewBox="0 0 24 24"
			class="size-5"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
			innerHTML={ICONS[props.name]}
		/>
	);
}
