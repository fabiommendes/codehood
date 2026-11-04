import { expect, test } from "@playwright/test";
import { createSlots } from "@/utils/concurrency";

test("a key holds at most perKey slots at once", () => {
	const slots = createSlots({ perKey: 2, total: 10 });
	expect(slots.acquire("ana")).toBeDefined();
	expect(slots.acquire("ana")).toBeDefined();
	expect(slots.acquire("ana")).toBeUndefined();
	expect(slots.acquire("bia")).toBeDefined();
});

test("the pool holds at most total slots across keys", () => {
	const slots = createSlots({ perKey: 2, total: 3 });
	slots.acquire("ana");
	slots.acquire("ana");
	slots.acquire("bia");
	expect(slots.acquire("caio")).toBeUndefined();
});

test("releasing a slot frees it for the key and the pool", () => {
	const slots = createSlots({ perKey: 1, total: 1 });
	const release = slots.acquire("ana");
	expect(slots.acquire("bia")).toBeUndefined();
	release?.();
	expect(slots.acquire("bia")).toBeDefined();
});

test("releasing the same slot twice frees it only once", () => {
	const slots = createSlots({ perKey: 2, total: 2 });
	const release = slots.acquire("ana");
	slots.acquire("ana");
	release?.();
	release?.();
	expect(slots.acquire("ana")).toBeDefined();
	expect(slots.acquire("ana")).toBeUndefined();
});
