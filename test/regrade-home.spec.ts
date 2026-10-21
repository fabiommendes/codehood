import { expect, test } from "@playwright/test";
import type { Exam } from "@/db";
import { type ExamRegrades, regradeQueue } from "@/services/instructor-home";
import {
	HOME_HORIZON_MS,
	type HomeCourse,
	type HomeRegrade,
	recentRegrades,
} from "@/services/student-home";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

const NOW = new Date("2026-03-10T14:00:00Z");

function at(ms: number): Date {
	return new Date(NOW.getTime() + ms);
}

const algebra: HomeCourse = {
	href: "/mat101/ada_2026-1",
	code: "mat101",
	name: "Algebra",
};

function exam(slug: string): Exam {
	return { slug, title: slug } as Exam;
}

//
// regradeQueue
//

type Request = ExamRegrades["requests"][number];

function open(createdAt: Date): Request {
	return { status: "OPEN", createdAt };
}

function resolved(createdAt: Date, status: "ACCEPTED" | "REJECTED"): Request {
	return { status, createdAt };
}

function examWith(slug: string, requests: Request[]): ExamRegrades {
	return { course: algebra, exam: exam(slug), requests };
}

function summary(items: ReturnType<typeof regradeQueue>) {
	return items.map((item) => ({
		exam: item.exam.slug,
		open: item.open,
		oldest: item.oldest,
	}));
}

test("regradeQueue: an exam with only resolved requests, or none, is left out", () => {
	const queue = regradeQueue([
		examWith("none", []),
		examWith("done", [
			resolved(at(-DAY), "ACCEPTED"),
			resolved(at(-DAY), "REJECTED"),
		]),
	]);

	expect(queue).toEqual([]);
});

test("regradeQueue: counts only OPEN requests and dates the oldest OPEN one, not an older resolved one", () => {
	const queue = regradeQueue([
		examWith("midterm", [
			resolved(at(-9 * DAY), "REJECTED"),
			open(at(-2 * DAY)),
			open(at(-3 * DAY)),
			open(at(-1 * DAY)),
		]),
	]);

	expect(queue).toHaveLength(1);
	expect(queue[0]).toMatchObject({
		course: algebra,
		open: 3,
		oldest: at(-3 * DAY),
	});
	expect(queue[0]?.exam.slug).toBe("midterm");
});

test("regradeQueue: the exam with the most open requests comes first, a tie going to the older oldest request", () => {
	const queue = regradeQueue([
		examWith("one-old", [open(at(-5 * DAY))]),
		examWith("two-recent", [open(at(-1 * DAY)), open(at(-1 * HOUR))]),
		examWith("two-older", [open(at(-3 * DAY)), open(at(-2 * DAY))]),
	]);

	expect(summary(queue)).toEqual([
		{ exam: "two-older", open: 2, oldest: at(-3 * DAY) },
		{ exam: "two-recent", open: 2, oldest: at(-1 * DAY) },
		{ exam: "one-old", open: 1, oldest: at(-5 * DAY) },
	]);
});

//
// recentRegrades
//

function regrade(
	publicId: string,
	status: HomeRegrade["request"]["status"],
	resolvedAt: Date | null,
): HomeRegrade {
	return {
		course: algebra,
		exam: exam("midterm"),
		request: { publicId, question: "q1", status, reply: null, resolvedAt },
	};
}

function ids(regrades: HomeRegrade[]): string[] {
	return regrades.map((entry) => entry.request.publicId);
}

test("recentRegrades: a request still OPEN is never listed", () => {
	expect(recentRegrades([regrade("open", "OPEN", null)], NOW)).toEqual([]);
});

test("recentRegrades: accepted and rejected requests are listed, newest resolution first", () => {
	const listed = recentRegrades(
		[
			regrade("older", "REJECTED", at(-3 * DAY)),
			regrade("newer", "ACCEPTED", at(-1 * DAY)),
		],
		NOW,
	);

	expect(ids(listed)).toEqual(["newer", "older"]);
});

test("recentRegrades: the horizon is 7 days, inclusive, and a resolution in the future is not listed", () => {
	expect(HOME_HORIZON_MS).toBe(7 * DAY);

	const listed = recentRegrades(
		[
			regrade("at-horizon", "ACCEPTED", at(-7 * DAY)),
			regrade("past-horizon", "ACCEPTED", at(-7 * DAY - 1)),
			regrade("just-now", "REJECTED", NOW),
			regrade("future", "REJECTED", at(1)),
		],
		NOW,
	);

	expect(ids(listed)).toEqual(["just-now", "at-horizon"]);
});
