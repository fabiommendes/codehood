import { expect, test } from "@playwright/test";
import { createSaveSchedule } from "@/components/exam/save-schedule";

/// A clock whose timers fire only when `advance` reaches them.
function fakeClock() {
	let now = 0;
	let next = 1;
	const timers = new Map<number, { at: number; run: () => void }>();
	return {
		set: (run: () => void, ms: number) => {
			timers.set(next, { at: now + ms, run });
			return next++;
		},
		clear: (id: number) => {
			timers.delete(id);
		},
		advance(ms: number) {
			now += ms;
			for (const [id, timer] of [...timers]) {
				if (timer.at > now) continue;
				timers.delete(id);
				timer.run();
			}
		},
	};
}

function setup(intervalMs = 30_000) {
	const clock = fakeClock();
	const saves: string[] = [];
	const schedule = createSaveSchedule({
		intervalMs,
		save: (slug) => saves.push(slug),
		setTimer: clock.set,
		clearTimer: clock.clear,
	});
	return { clock, saves, schedule };
}

test("an edit is saved one interval after it", () => {
	const { clock, saves, schedule } = setup();
	schedule.edited("q1");
	clock.advance(29_999);
	expect(saves).toEqual([]);
	clock.advance(1);
	expect(saves).toEqual(["q1"]);
});

test("edits that follow the first unsaved one do not postpone its save", () => {
	const { clock, saves, schedule } = setup();
	schedule.edited("q1");
	for (let typed = 0; typed < 29; typed++) {
		clock.advance(1000);
		schedule.edited("q1");
	}
	expect(saves).toEqual([]);
	clock.advance(1000);
	expect(saves).toEqual(["q1"]);
});

test("the interval of the next save counts from the first edit after the last one", () => {
	const { clock, saves, schedule } = setup();
	schedule.edited("q1");
	clock.advance(30_000);
	clock.advance(10_000);
	schedule.edited("q1");
	clock.advance(29_999);
	expect(saves).toEqual(["q1"]);
	clock.advance(1);
	expect(saves).toEqual(["q1", "q1"]);
});

test("each question keeps its own interval", () => {
	const { clock, saves, schedule } = setup();
	schedule.edited("q1");
	clock.advance(20_000);
	schedule.edited("q2");
	clock.advance(10_000);
	expect(saves).toEqual(["q1"]);
	clock.advance(20_000);
	expect(saves).toEqual(["q1", "q2"]);
});

test("a save made at once cancels the one that was waiting", () => {
	const { clock, saves, schedule } = setup();
	schedule.edited("q1");
	clock.advance(5000);
	schedule.cancel("q1");
	clock.advance(60_000);
	expect(saves).toEqual([]);

	schedule.edited("q1");
	clock.advance(30_000);
	expect(saves).toEqual(["q1"]);
});

test("nothing is saved after the schedule is disposed", () => {
	const { clock, saves, schedule } = setup();
	schedule.edited("q1");
	schedule.edited("q2");
	schedule.dispose();
	clock.advance(60_000);
	expect(saves).toEqual([]);
});
