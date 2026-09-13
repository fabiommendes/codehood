import { expect, test } from "@playwright/test";
import fc from "fast-check";
import { sanitizeFilename } from "@/utils/filename";

// Arbitrary strings, including empty ones, NUL bytes, path separators and
// dot-only names — sanitizeFilename either throws on these (a structural
// violation) or normalises them, and we don't know which until we call it.
// The property only asserts something about the non-throwing branch, which
// is where the four invariants live.
// Plain `fc.string()` almost never reaches the 255-byte truncation path, and
// truncation is where the interesting bugs live: stopping mid-separator, or
// counting characters where bytes were meant. So the generator deliberately
// straddles the limit, in both ASCII and multi-byte forms.
// `size: "max"` is load-bearing. fast-check biases lengths towards the
// minimum, so without it a `minLength: 300` string still slugifies to under
// the 255-byte limit and the truncation path — where the bugs are — is
// reached by roughly 0.3% of samples.
const longStem = fc.string({ minLength: 300, maxLength: 700, size: "max" });

const arbitraryName = fc.oneof(
	fc.string({ maxLength: 300 }),
	longStem,
	// Long runs of separator-producing characters, so a truncation lands on
	// one: "a-a-a-…" is the shape that breaks idempotence.
	fc
		.array(fc.constantFrom("a", " ", "-", "_", "é", "☕"), {
			minLength: 300,
			maxLength: 700,
			size: "max",
		})
		.map((chars) => chars.join("")),
	// The same, with an extension the truncation must never eat into.
	fc
		.tuple(longStem, fc.constantFrom(".pdf", ".txt", ".mdq", ".tar.gz"))
		.map(([stem, extension]) => stem + extension),
);

test("sanitizeFilename: result is a safe basename, fits 255 bytes, and is idempotent, for every input that doesn't throw", () => {
	let sawSuccess = false;
	fc.assert(
		fc.property(arbitraryName, (name) => {
			let result: string;
			try {
				result = sanitizeFilename(name);
			} catch {
				return; // a structural violation — outside this property's scope
			}
			sawSuccess = true;
			expect(result).toMatch(/^[a-z0-9][a-z0-9.-]*$/);
			expect(result).not.toContain("/");
			expect(result).not.toContain("\\");
			expect(result.startsWith(".")).toBe(false);
			// A trailing separator is what a naive truncation leaves behind,
			// and it is exactly what breaks idempotence: `slugify` strips it
			// on the second pass.
			expect(result).not.toMatch(/[-.]$/);
			expect(Buffer.byteLength(result, "utf-8")).toBeLessThanOrEqual(255);
			expect(sanitizeFilename(result)).toBe(result);
		}),
		// `endOnFailure` skips shrinking: a counterexample here is a several
		// hundred character string, and shrinking one takes minutes without
		// making the failure easier to read. The pinned test below is the
		// readable version of the same bug.
		{ numRuns: 300, endOnFailure: true },
	);
	// Guards against the property vacuously passing because every generated
	// input happened to throw.
	expect(sawSuccess).toBe(true);
});

// Pinned rather than left to the fuzzer: truncation has to stop exactly on a
// separator to expose this, and a regression here is silent — the name still
// looks reasonable, it just stops being stable under a second pass.
test("sanitizeFilename: truncation never leaves a trailing separator", () => {
	const name = `${"x".repeat(250)} tail.txt`;
	const once = sanitizeFilename(name);

	expect(once).not.toMatch(/[-.]$/);
	expect(sanitizeFilename(once)).toBe(once);
});

test("sanitizeFilename throws on structural violations", () => {
	const cases: Array<[string, string]> = [
		["", "empty"],
		["   ", "whitespace-only"],
		["a\0b.txt", "NUL byte"],
		["a/b.png", "path separator (/)"],
		["a\\b.png", "path separator (\\)"],
		[".", "basename '.'"],
		["..", "basename '..'"],
		["...", "only dots"],
		["../../etc/passwd", "path traversal"],
		// Exactly 64 lowercase hex chars — would collide with the blob's own
		// canonical entry in its directory.
		["a".repeat(64), "64 hex chars"],
		["0123456789abcdef".repeat(4), "64 hex chars, varied digits"],
	];

	for (const [input, label] of cases) {
		expect(() => sanitizeFilename(input), label).toThrow();
	}
});

test("sanitizeFilename normalises: slugifies the stem, lowercases a valid extension, and falls back to 'file'", () => {
	expect(sanitizeFilename("Week 1 Notes.PDF")).toBe("week-1-notes.pdf");
	expect(sanitizeFilename("!!!.txt")).toBe("file.txt");
	expect(sanitizeFilename("!!!")).toBe("file");
});

test("sanitizeFilename: an extension only counts when 1..16 alphanumeric characters", () => {
	// Too long to be an extension — the whole name is slugified as the stem.
	const tooLong = sanitizeFilename("report.abcdefghijklmnopq");
	expect(tooLong.endsWith(".abcdefghijklmnopq")).toBe(false);

	// Non-alphanumeric after the last dot — same treatment.
	const nonAlnum = sanitizeFilename("archive.tar-gz");
	expect(nonAlnum.endsWith(".tar-gz")).toBe(false);

	// Exactly 16 alphanumeric characters is still a valid extension.
	const sixteen = sanitizeFilename(`file.${"a".repeat(16)}`);
	expect(sixteen).toBe(`file.${"a".repeat(16)}`);
});

test("sanitizeFilename: truncates only the stem to fit 255 bytes, never the extension", () => {
	const result = sanitizeFilename(`${"a".repeat(400)}.pdf`);
	expect(Buffer.byteLength(result, "utf-8")).toBeLessThanOrEqual(255);
	expect(result.endsWith(".pdf")).toBe(true);
});

test("sanitizeFilename: NFC-normalises before slugifying", () => {
	// NFD ("e" + combining acute, U+0301) vs NFC (precomposed "\u00e9", U+00E9)
	// must sanitise the same way.
	const nfd = "cafe\u0301.txt";
	const nfc = "caf\u00e9.txt";
	expect(nfd).not.toBe(nfc); // sanity: the two source strings really differ
	expect(sanitizeFilename(nfd)).toBe(sanitizeFilename(nfc));
});
