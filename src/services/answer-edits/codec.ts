export type InputKind =
	| "typing"
	| "paste"
	| "delete"
	| "undo"
	| "redo"
	| "composition"
	| "other";

export type EditTiming = readonly [
	intervalCount: number,
	meanIntervalMs: number,
	intervalM2Ms2: number,
];
export type EditTuple = readonly [
	startDeltaMs: number,
	durationMs: number,
	position: number,
	deleteCount: number,
	insertedText: string,
	inputKind: number,
	timing: EditTiming | null,
];

export interface TextReplacement {
	readonly position: number;
	readonly deleteCount: number;
	readonly insertedText: string;
}

export interface AnswerEdit extends TextReplacement {
	readonly startMs: number;
	readonly durationMs: number;
	readonly kind: InputKind;
	readonly timing: EditTiming | null;
}

export interface EditEnvelope {
	readonly version: 1;
	readonly timeOriginMs: number;
	readonly edits: readonly EditTuple[];
}

const INPUT_KINDS: readonly InputKind[] = [
	"typing",
	"paste",
	"delete",
	"undo",
	"redo",
	"composition",
	"other",
];

/**
 * Encode absolute session times as independently decodable compact tuples.
 *
 * @throws {TypeError} If an edit or the time origin is invalid.
 */
export function encodeEdits(
	edits: readonly AnswerEdit[],
	timeOriginMs: number,
): EditEnvelope {
	const origin = nonnegativeNumber(timeOriginMs, "timeOriginMs");
	if (!Array.isArray(edits)) throw new TypeError("edits must be an array");

	const tuples: EditTuple[] = [];
	let previousStartMs = origin;
	for (const value of edits) {
		const edit = record(value, "edit");
		const replacement = parseReplacement(edit);
		const startMs = nonnegativeNumber(edit.startMs, "startMs");
		if (startMs < previousStartMs)
			throw new TypeError(
				"Edit start times must not regress or precede the origin",
			);
		const durationMs = nonnegativeNumber(edit.durationMs, "durationMs");
		const kindCode = INPUT_KINDS.indexOf(edit.kind as InputKind);
		if (kindCode < 0) throw new TypeError("Invalid input kind");
		const timing = parseTiming(edit.timing);
		tuples.push([
			startMs - previousStartMs,
			durationMs,
			replacement.position,
			replacement.deleteCount,
			replacement.insertedText,
			kindCode,
			timing,
		]);
		previousStartMs = startMs;
	}
	return { version: 1, timeOriginMs: origin, edits: tuples };
}

/**
 * Validate and decode a versioned edit envelope.
 *
 * @throws {TypeError} If the envelope contains invalid shapes, values or accumulated times.
 */
export function decodeEdits(envelope: unknown): readonly AnswerEdit[] {
	const data = record(envelope, "envelope");
	if (data.version !== 1)
		throw new TypeError("Unsupported edit envelope version");
	let previousStartMs = nonnegativeNumber(data.timeOriginMs, "timeOriginMs");
	if (!Array.isArray(data.edits)) throw new TypeError("edits must be an array");

	const edits: AnswerEdit[] = [];
	for (const tuple of data.edits) {
		if (!Array.isArray(tuple) || tuple.length !== 7)
			throw new TypeError("An edit tuple must have seven fields");
		const deltaMs = nonnegativeNumber(tuple[0], "startDeltaMs");
		const startMs = nonnegativeNumber(
			previousStartMs + deltaMs,
			"accumulated startMs",
		);
		const durationMs = nonnegativeNumber(tuple[1], "durationMs");
		const replacement = parseReplacement({
			position: tuple[2],
			deleteCount: tuple[3],
			insertedText: tuple[4],
		});
		const kindCode = nonnegativeInteger(tuple[5], "inputKind");
		const kind = INPUT_KINDS[kindCode];
		if (kind === undefined) throw new TypeError("Invalid input kind code");
		const timing = parseTiming(tuple[6]);
		edits.push({ ...replacement, startMs, durationMs, kind, timing });
		previousStartMs = startMs;
	}
	return edits;
}

/**
 * Replay sequential edits against a canonical UTF-16 string without normalization.
 *
 * @example
 * replayEdits("abc", encodeEdits([], 0)); // => "abc"
 *
 * @throws {TypeError} If the text, envelope or an operation's document bounds are invalid.
 */
export function replayEdits(initialText: string, envelope: unknown): string {
	if (typeof initialText !== "string")
		throw new TypeError("initialText must be a string");
	const edits = decodeEdits(envelope);
	let text = initialText;
	for (const edit of edits) {
		validateBounds(text, edit);
		text =
			text.slice(0, edit.position) +
			edit.insertedText +
			text.slice(edit.position + edit.deleteCount);
	}
	return text;
}

/**
 * Apply ordered, nonoverlapping replacements atomically in pre-transaction UTF-16 coordinates.
 *
 * @example
 * applyReplacements("abc", [{ position: 1, deleteCount: 1, insertedText: "X" }]); // => "aXc"
 *
 * @throws {TypeError} If text, replacement shapes, bounds or ordering are invalid.
 */
export function applyReplacements(
	text: string,
	replacements: readonly TextReplacement[],
): string {
	if (typeof text !== "string") throw new TypeError("text must be a string");
	if (!Array.isArray(replacements))
		throw new TypeError("replacements must be an array");

	const parts: string[] = [];
	let previousPosition = -1;
	let previousEnd = 0;
	for (const value of replacements) {
		const replacement = parseReplacement(value);
		validateBounds(text, replacement);
		if (
			replacement.position <= previousPosition ||
			replacement.position < previousEnd
		) {
			throw new TypeError(
				"Replacements must be ordered with distinct positions and no overlap",
			);
		}
		parts.push(
			text.slice(previousEnd, replacement.position),
			replacement.insertedText,
		);
		previousPosition = replacement.position;
		previousEnd = replacement.position + replacement.deleteCount;
	}
	parts.push(text.slice(previousEnd));
	return parts.join("");
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object`);
	}
	return value as Record<string, unknown>;
}

function nonnegativeNumber(value: unknown, name: string): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		throw new TypeError(`${name} must be a finite nonnegative number`);
	}
	return value;
}

function nonnegativeInteger(value: unknown, name: string): number {
	const number = nonnegativeNumber(value, name);
	if (!Number.isSafeInteger(number))
		throw new TypeError(`${name} must be a safe integer`);
	return number;
}

function parseTiming(value: unknown): EditTiming | null {
	if (value === null) return null;
	if (!Array.isArray(value) || value.length !== 3)
		throw new TypeError("timing must be null or a three-field tuple");
	const count = nonnegativeInteger(value[0], "intervalCount");
	if (count === 0) throw new TypeError("intervalCount must be positive");
	return [
		count,
		nonnegativeNumber(value[1], "meanIntervalMs"),
		nonnegativeNumber(value[2], "intervalM2Ms2"),
	];
}

function parseReplacement(value: unknown): TextReplacement {
	const replacement = record(value, "replacement");
	const position = nonnegativeInteger(replacement.position, "position");
	const deleteCount = nonnegativeInteger(
		replacement.deleteCount,
		"deleteCount",
	);
	if (typeof replacement.insertedText !== "string")
		throw new TypeError("insertedText must be a string");
	return { position, deleteCount, insertedText: replacement.insertedText };
}

function validateBounds(text: string, replacement: TextReplacement): void {
	if (
		replacement.position > text.length ||
		replacement.deleteCount > text.length - replacement.position
	) {
		throw new TypeError("Replacement exceeds document bounds");
	}
}
