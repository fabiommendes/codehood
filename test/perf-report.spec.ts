import { expect, test } from "@playwright/test";
import {
	compareRoutes,
	type Line,
	reportComparison,
	routeStats,
	slowSql,
} from "./perf/report";

/// `count` request lines of `route`, each with `db` ms in SQLite.
function hits(route: string, db: number, count = 3, queries = 4): Line[] {
	return Array.from({ length: count }, () => ({
		event: "request",
		route,
		db,
		queries,
		ms: db + 5,
	}));
}

test("routeStats takes the median and the maximum of each route", () => {
	const stats = routeStats([
		...hits("GET /a", 1, 2),
		...hits("GET /a", 9, 1, 30),
		{ event: "process", requests: 3 },
	]);
	expect([...stats.keys()]).toEqual(["GET /a"]);
	expect(stats.get("GET /a")).toMatchObject({
		n: 3,
		db: 1,
		dbMax: 9,
		queries: 4,
		queriesMax: 30,
	});
});

test("compareRoutes ranks the routes both runs hit by growth in SQLite time", () => {
	const base = routeStats([
		...hits("GET /scan", 2),
		...hits("GET /indexed", 2),
		...hits("GET /only-base", 2),
	]);
	const full = routeStats([
		...hits("GET /scan", 40),
		...hits("GET /indexed", 2.2),
		...hits("GET /only-full", 50),
	]);

	const changes = compareRoutes(base, full);
	expect(changes.map((change) => change.route)).toEqual([
		"GET /scan",
		"GET /indexed",
	]);
	expect(changes[0]?.ratio).toBeCloseTo(20);
	expect(changes[1]?.ratio).toBeCloseTo(1.1);
});

test("a route that stays under half a millisecond does not count as growth", () => {
	const changes = compareRoutes(
		routeStats(hits("GET /tiny", 0.05)),
		routeStats(hits("GET /tiny", 0.4)),
	);
	expect(changes[0]?.ratio).toBe(1);
});

test("slowSql groups by statement with the services and routes that ran it", () => {
	const slow = (sql: string, ms: number, op: string): Line => ({
		event: "slow-query",
		sql,
		ms,
		op,
		route: "GET /scan",
	});
	const entries = slowSql([
		slow("SELECT a", 8, "exam.findMany"),
		slow("SELECT a", 30, "course.findOne"),
		slow("SELECT b", 12, "exam.findMany"),
	]);
	expect(entries).toEqual([
		{
			sql: "SELECT a",
			n: 2,
			max: 30,
			ops: ["course.findOne", "exam.findMany"],
			routes: ["GET /scan"],
		},
		{
			sql: "SELECT b",
			n: 1,
			max: 12,
			ops: ["exam.findMany"],
			routes: ["GET /scan"],
		},
	]);
});

test("the comparison lists the routes that grew and the statements slow only on the full database", () => {
	const slow: Line = {
		event: "slow-query",
		sql: "SELECT * FROM Submission WHERE x = ?",
		ms: 38,
		op: "submission.findMany",
		route: "GET /scan",
	};
	const report = reportComparison(
		[...hits("GET /scan", 2), ...hits("GET /indexed", 2)],
		[...hits("GET /scan", 40), ...hits("GET /indexed", 2), slow],
	);

	expect(report).toContain("2 routes hit in both runs; 1 grew 2× or more");
	const grew = report.slice(
		report.indexOf("## Routes that grew"),
		report.indexOf("## Statements slow only"),
	);
	expect(grew).toContain("`GET /scan`");
	expect(grew).toContain("20.0×");
	expect(grew).not.toContain("GET /indexed");
	expect(report).toContain("SELECT * FROM Submission WHERE x = ?");
	expect(report).toContain("submission.findMany");
});
