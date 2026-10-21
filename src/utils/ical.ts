/**
 * Serialization of iCalendar (RFC 5545) documents.
 *
 * Covers only what a published, read-only feed needs: a `VCALENDAR` holding
 * `VEVENT`s with UTC times. Every line of the output ends in `CRLF` and is
 * folded at 75 octets.
 */

const encoder = new TextEncoder();

/// Maximum octets in a physical line, CRLF excluded.
const MAX_OCTETS = 75;

/// The `STATUS` values RFC 5545 allows on a `VEVENT`.
export type IcalEventStatus = "TENTATIVE" | "CONFIRMED" | "CANCELLED";

/**
 * One `VEVENT`. Text fields hold plain text and are escaped on output.
 *
 * Properties are written in this order, optional ones only when present (`DTEND`, `DESCRIPTION`, `URL`, `STATUS`):
 * `UID`, `DTSTAMP`, `DTSTART`, `DTEND`, `SUMMARY`, `DESCRIPTION`, `URL`,
 * `STATUS`.
 */
export interface IcalEvent {
	/// Globally unique and stable across renders, e.g. `event-12@codehood.example`.
	uid: string;
	/// When this version of the event was last changed.
	stamp: Date;
	start: Date;
	/// Omitted from the output when absent, which makes the event instantaneous.
	end?: Date;
	summary: string;
	/// Omitted from the output when absent or empty.
	description?: string;
	/// Absolute URL, written as a URI value (not escaped as text).
	url?: string;
	status?: IcalEventStatus;
}

/**
 * A `VCALENDAR` document.
 *
 * Written as `BEGIN:VCALENDAR`, `VERSION:2.0`, `PRODID`, `CALSCALE:GREGORIAN`,
 * then `METHOD` and `X-WR-CALNAME` when present, then every event in order,
 * then `END:VCALENDAR`.
 */
export interface IcalCalendar {
	/// Value of `PRODID`, e.g. `-//Codehood//Calendar//en`. Written as given.
	prodId: string;
	method?: "PUBLISH";
	/// Display name, written as `X-WR-CALNAME` and escaped as text.
	name?: string;
	events: readonly IcalEvent[];
}

/**
 * Renders `calendar` as an iCalendar document whose every line, the last one included, ends in `CRLF` and is folded with {@link foldLine}.
 *
 * @example
 * renderIcal({ prodId: "-//X//Y//en", events: [] });
 * // "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//X//Y//en\r\nCALSCALE:GREGORIAN\r\nEND:VCALENDAR\r\n"
 */
export function renderIcal(calendar: IcalCalendar): string {
	const lines = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		`PRODID:${calendar.prodId}`,
		"CALSCALE:GREGORIAN",
	];
	if (calendar.method) lines.push(`METHOD:${calendar.method}`);
	if (calendar.name) lines.push(`X-WR-CALNAME:${escapeText(calendar.name)}`);
	for (const event of calendar.events) lines.push(...eventLines(event));
	lines.push("END:VCALENDAR");
	return lines.map((line) => `${foldLine(line)}\r\n`).join("");
}

/**
 * Escapes `text` for a `TEXT` property value: `\` becomes `\\`, `;` becomes `\;`, `,` becomes `\,`, and each line break (`\r\n`, `\n` or `\r`) becomes the two characters `\n`.
 *
 * @example
 * escapeText("a,b;c\\d\ne"); // "a\\,b\\;c\\\\d\\ne"
 */
export function escapeText(text: string): string {
	return text
		.replace(/\\/g, "\\\\")
		.replace(/;/g, "\\;")
		.replace(/,/g, "\\,")
		.replace(/\r\n|\n|\r/g, "\\n");
}

/**
 * Folds one content line (without its `CRLF`) so no physical line exceeds 75 octets of UTF-8.
 *
 * Breaks are joined with `CRLF` followed by a single space, and that space
 * counts toward the next line's 75 octets. A multi-byte character is never
 * split. A line of 75 octets or less is returned unchanged.
 */
export function foldLine(line: string): string {
	if (encoder.encode(line).length <= MAX_OCTETS) return line;
	const parts: string[] = [];
	let current = "";
	let size = 0;
	for (const char of line) {
		const charSize = encoder.encode(char).length;
		if (size + charSize > MAX_OCTETS) {
			parts.push(current);
			current = " ";
			size = 1;
		}
		current += char;
		size += charSize;
	}
	parts.push(current);
	return parts.join("\r\n");
}

/**
 * Formats `instant` as a UTC `DATE-TIME` value, `YYYYMMDDTHHMMSSZ`, dropping milliseconds.
 *
 * @example
 * formatUtcDateTime(new Date("2026-03-02T14:05:09.900Z")); // "20260302T140509Z"
 */
export function formatUtcDateTime(instant: Date): string {
	return instant
		.toISOString()
		.replace(/\.\d+Z$/, "Z")
		.replace(/[-:]/g, "");
}

/// The content lines of one `VEVENT`, in the documented property order.
function eventLines(event: IcalEvent): string[] {
	const lines = [
		"BEGIN:VEVENT",
		`UID:${event.uid}`,
		`DTSTAMP:${formatUtcDateTime(event.stamp)}`,
		`DTSTART:${formatUtcDateTime(event.start)}`,
		`SUMMARY:${escapeText(event.summary)}`,
	];
	if (event.end) lines.splice(4, 0, `DTEND:${formatUtcDateTime(event.end)}`);
	if (event.description) {
		lines.push(`DESCRIPTION:${escapeText(event.description)}`);
	}
	if (event.url) lines.push(`URL:${event.url}`);
	if (event.status) lines.push(`STATUS:${event.status}`);
	lines.push("END:VEVENT");
	return lines;
}
