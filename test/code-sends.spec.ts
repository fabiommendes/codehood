import { expect, test } from "@playwright/test";
import {
	hasPendingSend,
	nextSendWorth,
	sendsOf,
} from "@/components/exam/code-sends";

const send = (
	jobState: "QUEUED" | "CLAIMED" | "DONE" | "FAILED" | "CANCELLED" | null,
) => ({
	submission: "s",
	jobState,
});

test("the counter is the attempts spent, and a practice exam has no limit", () => {
	expect(
		sendsOf({ attempts: 4, attemptsLeft: 3, submissions: [] }),
	).toMatchObject({
		used: 1,
		limit: 4,
	});
	expect(
		sendsOf({
			attempts: 4,
			attemptsLeft: null,
			submissions: [send("DONE"), send("QUEUED")],
		}),
	).toMatchObject({ used: 2, limit: null });
});

test("only a queued or claimed send keeps the page asking", () => {
	const of = (...states: Array<Parameters<typeof send>[0]>) =>
		sendsOf({ attempts: 2, attemptsLeft: 2, submissions: states.map(send) });
	expect(hasPendingSend(undefined)).toBe(false);
	expect(hasPendingSend(of("DONE", "FAILED", null))).toBe(false);
	expect(hasPendingSend(of("DONE", "QUEUED"))).toBe(true);
	expect(hasPendingSend(of("CLAIMED"))).toBe(true);
});

test("the next send is worth what the earlier ones leave, and a practice exam discounts nothing", () => {
	const read = { attempts: 4, attemptsLeft: 3, submissions: [] };
	expect(nextSendWorth(sendsOf(read, 0.2))).toBe(0.8);
	expect(nextSendWorth(sendsOf({ ...read, attemptsLeft: 0 }, 0.3))).toBe(0);
	expect(nextSendWorth(sendsOf(read, 0))).toBeNull();
	expect(
		nextSendWorth(sendsOf({ ...read, attemptsLeft: null }, 0.2)),
	).toBeNull();
});
