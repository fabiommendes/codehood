import type { JSX, ParentProps } from "solid-js";

interface AlertProps extends ParentProps {
	variant?: "info" | "success" | "warning" | "error";
	class?: string;
}

export default function Alert(props: AlertProps): JSX.Element {
	const classes = () =>
		["alert", props.variant && `alert-${props.variant}`, props.class]
			.filter(Boolean)
			.join(" ");

	return (
		<div role="alert" class={classes()}>
			{props.children}
		</div>
	);
}
