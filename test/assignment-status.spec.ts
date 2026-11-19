import { expect, test } from "@playwright/test";
import { readerStatus } from "@/services/assignment-status";

const now = new Date("2026-11-18T12:00:00Z");
const hours = (n: number) => new Date(now.getTime() + n * 3_600_000);
const push = { id: 1 };

function status(
	dueIn: number,
	delivery: { onTime?: boolean; late?: boolean },
	closesIn: number | null = null,
	individual = false,
) {
	return readerStatus({
		individual,
		closesAt: closesIn === null ? null : hours(closesIn),
		team: {
			dueAt: hours(dueIn),
			delivery: {
				onTime: delivery.onTime ? push : null,
				late: delivery.late ? push : null,
			},
		},
		now,
	});
}

test.describe("readerStatus", () => {
	test("a reader without a team has none of the delivery states", () => {
		const input = { closesAt: null, team: null, now };
		expect(readerStatus({ ...input, individual: false })).toBe("no-team");
		expect(readerStatus({ ...input, individual: true })).toBe("no-repository");
	});

	test("before the due date a team has either pushed or not", () => {
		expect(status(5, {})).toBe("no-push");
		expect(status(5, { onTime: true })).toBe("on-time");
	});

	test("after the due date the on-time delivery decides, and a late one adds to it", () => {
		expect(status(-5, { onTime: true })).toBe("on-time");
		expect(status(-5, { onTime: true, late: true })).toBe("late");
		expect(status(-5, { late: true })).toBe("no-delivery");
		expect(status(-5, {})).toBe("no-delivery");
	});

	test("closed pushes win over everything the team delivered", () => {
		expect(status(-5, { onTime: true }, -1)).toBe("closed");
		expect(status(-5, {}, 0)).toBe("closed");
		expect(status(-5, { onTime: true }, 3)).toBe("on-time");
	});
});
