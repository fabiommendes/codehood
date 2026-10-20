import { type JSX, Show } from "solid-js";
import Alert from "@/components/ui/Alert";

/** Shows the error that belongs to no field, and nothing when there is none. */
export default function FormAlert(props: {
	error?: string;
	class?: string;
}): JSX.Element {
	return (
		<Show when={props.error}>
			<Alert variant="error" class={props.class}>
				<span>{props.error}</span>
			</Alert>
		</Show>
	);
}
