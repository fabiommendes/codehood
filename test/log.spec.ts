import { expect, test } from "@playwright/test";
import { logEvent } from "@/utils/log";

/// Runs `fn` with `process.stdout.write` captured and returns what it wrote.
function capture(fn: () => void, write?: typeof process.stdout.write): string {
	const original = process.stdout.write;
	let out = "";
	process.stdout.write = ((chunk: string | Uint8Array) => {
		out += chunk.toString();
		return true;
	}) as typeof process.stdout.write;
	if (write) process.stdout.write = write;
	try {
		fn();
	} finally {
		process.stdout.write = original;
	}
	return out;
}

test("logEvent writes one JSON line with the event, an ISO time and the fields", () => {
	const before = Date.now();
	const out = capture(() => logEvent("thing.happened", { a: 1, b: "ç" }));

	expect(out.endsWith("\n")).toBe(true);
	expect(out.trimEnd().split("\n")).toHaveLength(1);
	const line = JSON.parse(out);
	expect(line).toMatchObject({ event: "thing.happened", a: 1, b: "ç" });
	expect(new Date(line.at).toISOString()).toBe(line.at);
	expect(new Date(line.at).getTime()).toBeGreaterThanOrEqual(before);
	expect(Object.keys(line).slice(0, 2)).toEqual(["event", "at"]);
});

test("a field cannot overwrite the event name or the time", () => {
	const out = capture(() =>
		logEvent("real", { event: "fake", at: "yesterday" }),
	);
	const line = JSON.parse(out);
	expect(line.event).toBe("real");
	expect(line.at).not.toBe("yesterday");
});

test("a field that cannot be serialized does not throw", () => {
	const circular: Record<string, unknown> = {};
	circular.self = circular;
	expect(() => {
		capture(() => logEvent("bad", { circular, big: 1n }));
	}).not.toThrow();
});

test("a broken stdout does not throw", () => {
	const broken = (() => {
		throw new Error("EPIPE");
	}) as unknown as typeof process.stdout.write;
	expect(() => capture(() => logEvent("x", {}), broken)).not.toThrow();
});
