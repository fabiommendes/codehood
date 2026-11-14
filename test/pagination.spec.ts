import { expect, test } from "@playwright/test";
import {
	clampPage,
	pageCount,
	pageRange,
	pageSlots,
} from "@/components/ui/pagination";

test("pageCount rounds up and never drops below one page", () => {
	expect(pageCount(0, 50)).toBe(1);
	expect(pageCount(50, 50)).toBe(1);
	expect(pageCount(51, 50)).toBe(2);
	expect(pageCount(20_000, 50)).toBe(400);
});

test("clampPage keeps a page inside the pages that exist", () => {
	expect(clampPage(0, 5)).toBe(1);
	expect(clampPage(3, 5)).toBe(3);
	expect(clampPage(9, 5)).toBe(5);
	expect(clampPage(2.7, 5)).toBe(2);
});

test("pageRange gives the 1-based rows of a page, the last one short", () => {
	expect(pageRange(1, 50, 230)).toEqual({ from: 1, to: 50 });
	expect(pageRange(5, 50, 230)).toEqual({ from: 201, to: 230 });
	expect(pageRange(1, 50, 0)).toEqual({ from: 0, to: 0 });
});

test("pageSlots lists every page when few exist", () => {
	expect(pageSlots(1, 1)).toEqual([1]);
	expect(pageSlots(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
});

test("pageSlots shows the ends and the neighbours of the current page", () => {
	expect(pageSlots(10, 20)).toEqual([1, "gap", 9, 10, 11, "gap", 20]);
});

test("pageSlots keeps seven slots as the current page reaches an end", () => {
	expect(pageSlots(1, 20)).toEqual([1, 2, 3, 4, 5, "gap", 20]);
	expect(pageSlots(4, 20)).toEqual([1, 2, 3, 4, 5, "gap", 20]);
	expect(pageSlots(5, 20)).toEqual([1, "gap", 4, 5, 6, "gap", 20]);
	expect(pageSlots(17, 20)).toEqual([1, "gap", 16, 17, 18, 19, 20]);
	expect(pageSlots(20, 20)).toEqual([1, "gap", 16, 17, 18, 19, 20]);
});

test("a gap never hides a single page", () => {
	for (let pages = 1; pages <= 30; pages++) {
		for (let page = 1; page <= pages; page++) {
			const slots = pageSlots(page, pages);
			slots.forEach((slot, i) => {
				if (slot !== "gap") return;
				const before = slots[i - 1] as number;
				const after = slots[i + 1] as number;
				expect(after - before).toBeGreaterThan(2);
			});
		}
	}
});
