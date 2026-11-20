import type { JSX, ParentProps } from "solid-js";
import Link from "@/components/Link";
import type { LinkTarget } from "@/urls";

interface ButtonProps extends ParentProps {
	variant?:
		| "primary"
		| "secondary"
		| "accent"
		| "neutral"
		| "ghost"
		| "outline"
		| "error"
		| "success"
		| "warning"
		| "info";
	size?: "xs" | "sm" | "md" | "lg" | "xl";
	href?: LinkTarget;
	type?: "button" | "submit" | "reset";
	disabled?: boolean;
	class?: string;
}

export default function Button(props: ButtonProps): JSX.Element {
	const classes = () =>
		[
			"btn",
			props.variant && `btn-${props.variant}`,
			props.size && `btn-${props.size}`,
			props.class,
		]
			.filter(Boolean)
			.join(" ");

	return props.href ? (
		<Link href={props.href} class={classes()}>
			{props.children}
		</Link>
	) : (
		<button
			type={props.type ?? "button"}
			class={classes()}
			disabled={props.disabled ?? false}
		>
			{props.children}
		</button>
	);
}
