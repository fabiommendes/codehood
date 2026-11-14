/**
 * The load test follows the real exam page: it reads the page's timings from
 * its source and must call the same actions. When the page changes its pace
 * or starts calling a new action, this spec fails until `test/load/` follows.
 */

import { expect, test } from "@playwright/test";
import { answerOf, CODE_QUESTIONS } from "./load/questions";
import { clientActions, clientRhythm, STUDENT_ACTIONS } from "./load/rhythm";
import {
	cleanAnswer,
	Dice,
	questionOrder,
	seededRandom,
	typingPlan,
} from "./load/student";

test("the synthetic student calls the actions the exam page calls", () => {
	expect(STUDENT_ACTIONS).toEqual(clientActions());
});

test("the exam page's timings are still plain constants the load can read", () => {
	const rhythm = clientRhythm();
	for (const [name, value] of Object.entries(rhythm)) {
		expect(value, name).toBeGreaterThan(0);
	}
});

test("a typing plan writes the answer without its <remove> spans", () => {
	const dice = new Dice(seededRandom(7));
	for (const question of CODE_QUESTIONS) {
		const answer = answerOf(question, "correct");
		const annotated = answer.replace(" =", " =<remove> todo</remove>");
		const plan = typingPlan(annotated, 4, dice);
		const kept = plan
			.filter((s) => !s.removable)
			.map((s) => s.text)
			.join("");
		expect(kept).toBe(cleanAnswer(annotated));
		expect(kept).toBe(answer);
		expect(plan.some((s) => s.removable)).toBe(true);
	}
});

test("the question order mostly follows the exam", () => {
	const dice = new Dice(seededRandom(3));
	const exam = [0, 1, 2, 3, 4, 5, 6, 7];
	const orders = Array.from({ length: 200 }, () =>
		questionOrder(exam, 0.5, dice),
	);
	const inOrder = orders.filter((order) =>
		order.every((q, i) => q === i),
	).length;
	expect(inOrder).toBeGreaterThan(20);
	expect(inOrder).toBeLessThan(200);
	expect(questionOrder(exam, 0, dice)).toEqual(exam);
});
