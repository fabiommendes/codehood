/// Geometry of the shell bars pinned while an editor window is maximized.

/** Where a sticky bar is pinned and the padding that keeps its content in place. */
export interface PinGeometry {
	left: number;
	paddingLeft: number;
	paddingRight: number;
}

/**
 * Stretches a bar over the content area, growing its padding by what its box grew.
 *
 * `contentLeft` is the left edge of the content area; `viewportRight` is the
 * right edge of the viewport without the scrollbar.
 */
export function pinGeometry(input: {
	paddingLeft: number;
	paddingRight: number;
	rect: { left: number; right: number };
	contentLeft: number;
	viewportRight: number;
}): PinGeometry {
	return {
		left: input.contentLeft,
		paddingLeft: input.paddingLeft + input.rect.left - input.contentLeft,
		paddingRight: input.paddingRight + input.viewportRight - input.rect.right,
	};
}

/** Top of the window: the lowest bottom edge among the navbar and the pinned bars. */
export function windowTop(bottoms: readonly number[]): number {
	return Math.max(0, ...bottoms);
}
