import { expect, test } from "@playwright/test";
import { type PublicOrderingQuestion, publicForm } from "@/mdq";
import { capitalChoice, fibonacciOrdering } from "@/mdq/fixtures";
import { shufflePool } from "@/mdq/shuffle";

const form = publicForm(fibonacciOrdering) as PublicOrderingQuestion;

test("the same seed gives the same order", () => {
	expect(shufflePool(form, "a:fibonacci").pool).toEqual(
		shufflePool(form, "a:fibonacci").pool,
	);
});

test("a shuffled pool holds the same lines", () => {
	const pool = shufflePool(form, "a:fibonacci").pool;
	expect([...pool].sort()).toEqual([...form.pool].sort());
});

test("some seeds move the pool out of its sorted order", () => {
	const sorted = JSON.stringify(form.pool);
	const moved = ["a", "b", "c", "d", "e"].filter(
		(seed) => JSON.stringify(shufflePool(form, seed).pool) !== sorted,
	);
	expect(moved.length).toBeGreaterThan(0);
});

test("a question of another type is returned as is", () => {
	const choice = publicForm(capitalChoice);
	expect(shufflePool(choice, "a")).toBe(choice);
});
