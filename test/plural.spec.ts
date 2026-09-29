import { expect, test } from "@playwright/test";
import { plural } from "@/utils/plural";

const cases: [number, string, string | undefined, string][] = [
	[0, "admin", undefined, "0 admins"],
	[1, "admin", undefined, "1 admin"],
	[2, "admin", undefined, "2 admins"],
	[1, "person", "people", "1 person"],
	[3, "person", "people", "3 people"],
];

for (const [count, one, many, expected] of cases) {
	test(`plural(${count}, "${one}"${many ? `, "${many}"` : ""}) is "${expected}"`, () => {
		expect(plural(count, one, many)).toBe(expected);
	});
}
