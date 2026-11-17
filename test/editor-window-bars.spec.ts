import { expect, test } from "@playwright/test";
import { pinGeometry, windowTop } from "@/components/runner/editor-window-bars";

test("pinGeometry grows the padding by what the box grew", () => {
	const pinned = pinGeometry({
		paddingLeft: 16,
		paddingRight: 16,
		rect: { left: 300, right: 1100 },
		contentLeft: 256,
		viewportRight: 1200,
	});
	expect(pinned).toEqual({ left: 256, paddingLeft: 60, paddingRight: 116 });
});

test("pinGeometry keeps the padding when the bar already spans the area", () => {
	const pinned = pinGeometry({
		paddingLeft: 8,
		paddingRight: 8,
		rect: { left: 0, right: 900 },
		contentLeft: 0,
		viewportRight: 900,
	});
	expect(pinned).toEqual({ left: 0, paddingLeft: 8, paddingRight: 8 });
});

test("windowTop is the lowest bottom, never negative", () => {
	expect(windowTop([64, 90, 12])).toBe(90);
	expect(windowTop([])).toBe(0);
	expect(windowTop([-5])).toBe(0);
});
