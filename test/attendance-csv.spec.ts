import { expect, test } from "@playwright/test";
import type { CourseAttendance } from "@/db/services/roll-call.service";
import { attendanceCsvRows } from "@/services/attendance-table";

const EVENT_1 = {
	week: 1,
	title: "Aula 1",
	startAt: new Date("2026-03-02T14:00:00.000Z"),
	timeSlot: "manha",
};
const EVENT_2 = {
	week: 2,
	title: "Aula 2",
	startAt: new Date("2026-03-09T14:00:00.000Z"),
	timeSlot: "tarde",
};

test("T7-01 the header names the fixed columns, then one column per event, then the totals", () => {
	const report: CourseAttendance = {
		events: [EVENT_1, EVENT_2],
		students: [],
	};
	const [header] = attendanceCsvRows(report);
	expect(header).toEqual([
		"username",
		"name",
		"schoolId",
		"status",
		"1/manha",
		"2/tarde",
		"present",
		"total",
		"%",
	]);
});

test("T7-02 each cell reads 1, 0 or -, and the status column reads dropped or active", () => {
	const report: CourseAttendance = {
		events: [EVENT_1, EVENT_2],
		students: [
			{
				username: "ada",
				name: "Ada Lovelace",
				email: "ada@example.com",
				schoolId: "2026001",
				status: "ACTIVE",
				cells: { "1/manha": "present", "2/tarde": "absent" },
				present: 1,
				total: 2,
			},
			{
				username: "bob",
				name: "Bob Dropped",
				email: "bob@example.com",
				schoolId: "2026002",
				status: "DROPPED",
				cells: { "1/manha": "before-enrollment", "2/tarde": "present" },
				present: 1,
				total: 2,
			},
		],
	};
	const [, ada, bob] = attendanceCsvRows(report);
	expect(ada).toEqual([
		"ada",
		"Ada Lovelace",
		"2026001",
		"active",
		"1",
		"0",
		"1",
		"2",
		"50.00",
	]);
	expect(bob).toEqual([
		"bob",
		"Bob Dropped",
		"2026002",
		"dropped",
		"-",
		"1",
		"1",
		"2",
		"50.00",
	]);
});

test("T7-03 the percentage has two decimals and an empty cell when there are no roll calls", () => {
	const report = (present: number, total: number): CourseAttendance => ({
		events: Array.from({ length: total }, (_, i) => ({
			...EVENT_1,
			week: i + 1,
		})),
		students: [
			{
				username: "ada",
				name: "Ada Lovelace",
				email: "ada@example.com",
				schoolId: "2026001",
				status: "ACTIVE",
				cells: {},
				present,
				total,
			},
		],
	});
	const percentOf = (present: number, total: number) =>
		attendanceCsvRows(report(present, total))[1]?.at(-1);

	expect(percentOf(1, 3)).toBe("33.33");
	expect(percentOf(2, 3)).toBe("66.67");
	expect(percentOf(2, 2)).toBe("100.00");
	expect(percentOf(0, 0)).toBe("");
});
