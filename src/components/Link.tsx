import { type JSX, splitProps } from "solid-js";
import type { LinkTarget } from "@/urls";

/** The props of {@link Link}: those of `<a>`, with `href` a {@link LinkTarget}. */
export interface LinkProps
	extends Omit<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
	href: LinkTarget;
}

/**
 * The one `<a>` of the islands: `href` comes from the registry (`urls`), or
 * from `external()` or `anchor()`, never from a plain string.
 */
export default function Link(props: LinkProps): JSX.Element {
	const [local, rest] = splitProps(props, ["href"]);
	return <a href={local.href} {...rest} />;
}
