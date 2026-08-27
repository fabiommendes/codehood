import type { JSX, ParentProps } from "solid-js";

interface CardProps extends ParentProps {
	title?: string;
	bordered?: boolean;
	class?: string;
}

export default function Card(props: CardProps): JSX.Element {
	const classes = () =>
		["card", (props.bordered ?? true) && "card-border", props.class]
			.filter(Boolean)
			.join(" ");

	return (
		<div class={classes()}>
			<div class="card-body">
				{props.title && <h2 class="card-title">{props.title}</h2>}
				{props.children}
			</div>
		</div>
	);
}
