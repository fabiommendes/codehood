import type { JSX, ParentProps } from "solid-js";

interface BadgeProps extends ParentProps {
	variant?:
		| "neutral"
		| "primary"
		| "secondary"
		| "accent"
		| "info"
		| "success"
		| "warning"
		| "error";
	style?: "outline" | "dash" | "soft" | "ghost";
	size?: "xs" | "sm" | "md" | "lg" | "xl";
	class?: string;
}

export default function Badge(props: BadgeProps): JSX.Element {
	const classes = () =>
		[
			"badge",
			props.variant && `badge-${props.variant}`,
			props.style && `badge-${props.style}`,
			props.size && `badge-${props.size}`,
			props.class,
		]
			.filter(Boolean)
			.join(" ");

	return <span class={classes()}>{props.children}</span>;
}
