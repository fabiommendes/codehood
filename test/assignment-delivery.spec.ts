import { expect, test } from "@playwright/test";
import {
	checkpointDeliveries,
	pushRules,
	teamDelivery,
} from "@/services/assignment-delivery";

/// Which push counts as a team's delivery, and the rules a push is held to.

const DUE = new Date("2030-03-10T12:00:00Z");
const at = (hours: number) => new Date(DUE.getTime() + hours * 3_600_000);

function push(id: number, createdAt: Date) {
	return {
		id,
		teamId: 1,
		username: "ana",
		oldSha: null,
		newSha: String(id).padStart(40, "0"),
		createdAt,
	};
}

test.describe("checkpointDeliveries", () => {
	const parser = { slug: "parser", at: at(-48) };
	const typer = { slug: "typer", at: at(-24) };
	const ids = (pushes: ReturnType<typeof push>[]) =>
		checkpointDeliveries(pushes, [parser, typer]).map((entry) => [
			entry.slug,
			entry.push?.id ?? null,
		]);

	test("has no push for any checkpoint when the team never pushed", () => {
		expect(ids([])).toEqual([
			["parser", null],
			["typer", null],
		]);
	});

	test("takes the last push at or before each date", () => {
		const pushes = [push(1, at(-60)), push(2, at(-50)), push(3, at(-30))];

		expect(ids(pushes)).toEqual([
			["parser", 2],
			["typer", 3],
		]);
	});

	test("a push exactly at the date counts, one a millisecond later does not", () => {
		const onTheDot = push(1, parser.at);
		const justAfter = push(2, new Date(parser.at.getTime() + 1));

		const [first] = checkpointDeliveries([onTheDot, justAfter], [parser]);

		expect(first?.push?.id).toBe(1);
	});

	test("a team whose first push came after the date has none for it", () => {
		expect(ids([push(1, at(-40))])).toEqual([
			["parser", null],
			["typer", 1],
		]);
	});

	test("one push counts for two checkpoints when nothing came between them", () => {
		expect(ids([push(1, at(-70)), push(2, at(-1))])).toEqual([
			["parser", 1],
			["typer", 1],
		]);
	});

	test("two pushes at the same instant resolve to the larger id", () => {
		const pushes = [push(7, at(-50)), push(9, at(-50)), push(8, at(-50))];

		expect(ids(pushes)[0]).toEqual(["parser", 9]);
	});

	test("follows the order of the checkpoints given", () => {
		const result = checkpointDeliveries([], [typer, parser]);

		expect(result.map((entry) => entry.slug)).toEqual(["typer", "parser"]);
	});
});

test.describe("teamDelivery", () => {
	test("has neither delivery without a push", () => {
		expect(teamDelivery([], DUE)).toEqual({ onTime: null, late: null });
	});

	test("takes the last push before the deadline as the on-time delivery", () => {
		const pushes = [push(1, at(-30)), push(2, at(-20)), push(3, at(-10))];

		const delivery = teamDelivery(pushes, DUE);

		expect(delivery.onTime?.id).toBe(3);
		expect(delivery.late).toBeNull();
	});

	test("has only a late delivery when every push came after the deadline", () => {
		const pushes = [push(1, at(1)), push(2, at(5))];

		const delivery = teamDelivery(pushes, DUE);

		expect(delivery.onTime).toBeNull();
		expect(delivery.late?.id).toBe(2);
	});

	test("has both when the team pushed before and after", () => {
		const pushes = [
			push(1, at(-3)),
			push(2, at(-1)),
			push(3, at(2)),
			push(4, at(9)),
		];

		const delivery = teamDelivery(pushes, DUE);

		expect(delivery.onTime?.id).toBe(2);
		expect(delivery.late?.id).toBe(4);
	});

	test("an extension moves a late push to on time, with the same history", () => {
		const pushes = [push(1, at(-3)), push(2, at(5))];

		const strict = teamDelivery(pushes, DUE);
		const extended = teamDelivery(pushes, at(24));

		expect(strict.onTime?.id).toBe(1);
		expect(strict.late?.id).toBe(2);
		expect(extended.onTime?.id).toBe(2);
		expect(extended.late).toBeNull();
	});

	test("a push made at the very deadline is on time", () => {
		const delivery = teamDelivery([push(1, DUE)], DUE);

		expect(delivery.onTime?.id).toBe(1);
		expect(delivery.late).toBeNull();
	});

	test("a push a millisecond after the deadline is late", () => {
		const delivery = teamDelivery([push(1, new Date(DUE.getTime() + 1))], DUE);

		expect(delivery.onTime).toBeNull();
		expect(delivery.late?.id).toBe(1);
	});

	test("does not depend on the order of the input", () => {
		const pushes = [
			push(1, at(-3)),
			push(2, at(-1)),
			push(3, at(2)),
			push(4, at(9)),
		];
		const expected = teamDelivery(pushes, DUE);

		for (const shuffled of [
			[...pushes].reverse(),
			[pushes[2], pushes[0], pushes[3], pushes[1]] as typeof pushes,
		]) {
			const delivery = teamDelivery(shuffled, DUE);
			expect(delivery.onTime?.id).toBe(expected.onTime?.id);
			expect(delivery.late?.id).toBe(expected.late?.id);
		}
	});

	test("breaks a tie on the instant by the larger id, whatever the order", () => {
		const same = at(-2);
		const pushes = [push(5, same), push(9, same), push(7, same)];

		expect(teamDelivery(pushes, DUE).onTime?.id).toBe(9);
		expect(teamDelivery([...pushes].reverse(), DUE).onTime?.id).toBe(9);

		const lateSame = at(2);
		const latePushes = [push(12, lateSame), push(11, lateSame)];
		expect(teamDelivery(latePushes, DUE).late?.id).toBe(12);
		expect(teamDelivery([...latePushes].reverse(), DUE).late?.id).toBe(12);
	});
});

test.describe("pushRules", () => {
	const limits = { maxRepoBytes: 50_000_000, maxFileBytes: 10_000_000 };
	const base = { closesAt: null, restrictions: null };

	test("a restriction above the limit of the instance gives way to the limit", () => {
		const rules = pushRules({
			assignment: {
				...base,
				restrictions: { maxRepoBytes: 90_000_000, maxFileBytes: 20_000_000 },
			},
			enrolled: true,
			now: DUE,
			limits,
		});

		expect(rules.maxRepoBytes).toBe(50_000_000);
		expect(rules.maxFileBytes).toBe(10_000_000);
	});

	test("a restriction below the limit of the instance wins", () => {
		const rules = pushRules({
			assignment: {
				...base,
				restrictions: { maxRepoBytes: 1_000_000, maxFileBytes: 200_000 },
			},
			enrolled: true,
			now: DUE,
			limits,
		});

		expect(rules.maxRepoBytes).toBe(1_000_000);
		expect(rules.maxFileBytes).toBe(200_000);
	});

	test("without restrictions the limits are those of the instance", () => {
		const rules = pushRules({
			assignment: base,
			enrolled: true,
			now: DUE,
			limits,
		});

		expect(rules.maxRepoBytes).toBe(50_000_000);
		expect(rules.maxFileBytes).toBe(10_000_000);
	});

	test("deny comes from the restrictions, and is empty when absent", () => {
		const withDeny = pushRules({
			assignment: { ...base, restrictions: { deny: ["*.zip", "**/*.exe"] } },
			enrolled: true,
			now: DUE,
			limits,
		});
		const without = pushRules({
			assignment: { ...base, restrictions: { maxFileBytes: 100 } },
			enrolled: true,
			now: DUE,
			limits,
		});
		const none = pushRules({
			assignment: base,
			enrolled: true,
			now: DUE,
			limits,
		});

		expect(withDeny.deny).toEqual(["*.zip", "**/*.exe"]);
		expect(without.deny).toEqual([]);
		expect(none.deny).toEqual([]);
	});

	test("the assignment is closed from closesAt on, and not before", () => {
		const assignment = { ...base, closesAt: DUE };
		const rules = (now: Date) =>
			pushRules({ assignment, enrolled: true, now, limits });

		expect(rules(new Date(DUE.getTime() - 1)).closed).toBe(false);
		expect(rules(DUE).closed).toBe(true);
		expect(rules(new Date(DUE.getTime() + 1)).closed).toBe(true);
	});

	test("an assignment with no closesAt never closes", () => {
		const rules = pushRules({
			assignment: base,
			enrolled: true,
			now: new Date("2999-01-01T00:00:00Z"),
			limits,
		});

		expect(rules.closed).toBe(false);
	});

	test("passes the enrollment state through", () => {
		for (const enrolled of [true, false]) {
			const rules = pushRules({
				assignment: base,
				enrolled,
				now: DUE,
				limits,
			});
			expect(rules.enrolled).toBe(enrolled);
		}
	});

	test("carries no messages: the caller adds them", () => {
		const rules = pushRules({
			assignment: base,
			enrolled: true,
			now: DUE,
			limits,
		});

		expect("messages" in rules).toBe(false);
	});
});
