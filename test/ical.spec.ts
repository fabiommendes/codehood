import { expect, test } from "@playwright/test";
import {
	escapeText,
	foldLine,
	formatUtcDateTime,
	type IcalEvent,
	renderIcal,
} from "@/utils/ical";

// RFC 5545 serialization: text escaping, line folding, UTC times, document layout.

const encoder = new TextEncoder();

function octets(line: string): number {
	return encoder.encode(line).length;
}

/// Undoes folding: removes each CRLF followed by one space.
function unfold(folded: string): string {
	return folded.replaceAll("\r\n ", "");
}

//
// escapeText
//

const ESCAPES: [string, string, string][] = [
	["backslash", "a\\b", "a\\\\b"],
	["semicolon", "a;b", "a\\;b"],
	["comma", "a,b", "a\\,b"],
	["LF", "a\nb", "a\\nb"],
	["CRLF as a single break", "a\r\nb", "a\\nb"],
	["lone CR", "a\rb", "a\\nb"],
	["all together", "a,b;c\\d\ne", "a\\,b\\;c\\\\d\\ne"],
	["backslash before a comma is not double-consumed", "\\,", "\\\\\\,"],
	["a literal backslash-n is not a line break", "a\\nb", "a\\\\nb"],
	[
		"plain text and non-ASCII unchanged",
		"Prova: P1 · açaí",
		"Prova: P1 · açaí",
	],
];

for (const [name, input, expected] of ESCAPES) {
	test(`escapeText escapes ${name}`, () => {
		expect(escapeText(input)).toBe(expected);
	});
}

//
// foldLine
//

test("foldLine returns a line of exactly 75 octets unchanged", () => {
	const line = "a".repeat(75);

	expect(foldLine(line)).toBe(line);
});

test("foldLine breaks a 76-octet line into 75 octets plus a CRLF-space continuation", () => {
	const line = "a".repeat(76);

	expect(foldLine(line)).toBe(`${"a".repeat(75)}\r\n a`);
});

test("foldLine counts the continuation space toward the next line's 75 octets", () => {
	const line = "a".repeat(75 + 74 + 1);

	expect(foldLine(line)).toBe(`${"a".repeat(75)}\r\n ${"a".repeat(74)}\r\n a`);
});

const MULTIBYTE: [string, string][] = [
	["2-octet", "é"],
	["3-octet", "€"],
	["4-octet", "😀"],
];

for (const [name, char] of MULTIBYTE) {
	test(`foldLine never splits a ${name} UTF-8 character, wherever the break falls`, () => {
		// Shift the character across every alignment around the first break.
		for (let pad = 66; pad <= 76; pad++) {
			const line = `${"a".repeat(pad)}${char.repeat(60)}`;

			const folded = foldLine(line);

			for (const physical of folded.split("\r\n")) {
				expect(octets(physical)).toBeLessThanOrEqual(75);
			}
			expect(unfold(folded)).toBe(line);
			expect(folded).not.toContain("�");
		}
	});
}

//
// formatUtcDateTime
//

test("formatUtcDateTime writes YYYYMMDDTHHMMSSZ and drops milliseconds", () => {
	expect(formatUtcDateTime(new Date("2026-03-02T14:05:09.900Z"))).toBe(
		"20260302T140509Z",
	);
});

test("formatUtcDateTime zero-pads every field and uses UTC at the year boundary", () => {
	expect(formatUtcDateTime(new Date("2027-01-01T00:00:00.000Z"))).toBe(
		"20270101T000000Z",
	);
	expect(formatUtcDateTime(new Date("2026-12-31T23:59:59.999Z"))).toBe(
		"20261231T235959Z",
	);
});

//
// renderIcal
//

const EVENT: IcalEvent = {
	uid: "event-12@codehood.example",
	stamp: new Date("2026-03-01T08:00:00Z"),
	start: new Date("2026-03-02T14:00:00Z"),
	end: new Date("2026-03-02T15:30:00Z"),
	summary: "cs101 · Aula",
	description: "Sala 1, bloco A",
	url: "https://codehood.example/c/cs101?week=2026-W10",
	status: "CANCELLED",
};

test("renderIcal writes an empty calendar as the documented header and footer", () => {
	expect(renderIcal({ prodId: "-//X//Y//en", events: [] })).toBe(
		"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//X//Y//en\r\nCALSCALE:GREGORIAN\r\nEND:VCALENDAR\r\n",
	);
});

test("renderIcal writes METHOD and an escaped X-WR-CALNAME after CALSCALE", () => {
	const output = renderIcal({
		prodId: "-//Codehood//Calendar//pt-BR",
		method: "PUBLISH",
		name: "Codehood, Ana; Silva",
		events: [],
	});

	expect(output).toBe(
		[
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"PRODID:-//Codehood//Calendar//pt-BR",
			"CALSCALE:GREGORIAN",
			"METHOD:PUBLISH",
			"X-WR-CALNAME:Codehood\\, Ana\\; Silva",
			"END:VCALENDAR",
			"",
		].join("\r\n"),
	);
});

test("renderIcal writes a full event with properties in the documented order, text escaped and URL verbatim", () => {
	const output = renderIcal({ prodId: "-//X//Y//en", events: [EVENT] });

	expect(output).toBe(
		[
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"PRODID:-//X//Y//en",
			"CALSCALE:GREGORIAN",
			"BEGIN:VEVENT",
			"UID:event-12@codehood.example",
			"DTSTAMP:20260301T080000Z",
			"DTSTART:20260302T140000Z",
			"DTEND:20260302T153000Z",
			"SUMMARY:cs101 · Aula",
			"DESCRIPTION:Sala 1\\, bloco A",
			"URL:https://codehood.example/c/cs101?week=2026-W10",
			"STATUS:CANCELLED",
			"END:VEVENT",
			"END:VCALENDAR",
			"",
		].join("\r\n"),
	);
});

test("renderIcal omits DESCRIPTION when empty or absent, and URL and STATUS when absent", () => {
	const bare: IcalEvent = {
		uid: "exam-3@codehood.example",
		stamp: EVENT.stamp,
		start: EVENT.start,
		end: EVENT.start,
		summary: "cs101 · Prova: P1",
	};

	const output = renderIcal({
		prodId: "-//X//Y//en",
		events: [
			bare,
			{ ...bare, uid: "exam-4@codehood.example", description: "" },
		],
	});

	expect(output).not.toMatch(/DESCRIPTION|URL:|STATUS/);
	expect(output).toContain(
		"DTSTART:20260302T140000Z\r\nDTEND:20260302T140000Z\r\n",
	);
});

test("renderIcal writes one VEVENT per event, in the given order", () => {
	const events = [
		{ ...EVENT, uid: "event-1@h" },
		{ ...EVENT, uid: "event-2@h" },
		{ ...EVENT, uid: "event-3@h" },
	];

	const output = renderIcal({ prodId: "-//X//Y//en", events });

	expect(output.match(/BEGIN:VEVENT/g)).toHaveLength(3);
	expect(output.match(/END:VEVENT/g)).toHaveLength(3);
	expect(output.match(/UID:event-\d@h/g)).toEqual([
		"UID:event-1@h",
		"UID:event-2@h",
		"UID:event-3@h",
	]);
});

test("renderIcal folds long lines at 75 octets and ends every line, the last included, with CRLF", () => {
	const output = renderIcal({
		prodId: "-//X//Y//en",
		events: [
			{ ...EVENT, summary: "é".repeat(100), description: "x".repeat(200) },
		],
	});

	expect(output.endsWith("\r\n")).toBe(true);
	expect(output.replaceAll("\r\n", "")).not.toMatch(/[\r\n]/);
	for (const physical of output.split("\r\n")) {
		expect(octets(physical)).toBeLessThanOrEqual(75);
	}
	expect(unfold(output)).toContain(`SUMMARY:${"é".repeat(100)}\r\n`);
	expect(unfold(output)).toContain(`DESCRIPTION:${"x".repeat(200)}\r\n`);
});
