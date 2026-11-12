/**
 * Writes one JSON line, `{ event, at, ...fields }`, to stdout.
 *
 * Never throws: a field that cannot be serialized or a stdout that is broken
 * loses the line, not the caller's work.
 *
 * @example
 * logEvent("answer-history.removed", { attempts: 1 });
 */
export function logEvent(name: string, fields: Record<string, unknown>): void {
	try {
		const at = new Date().toISOString();
		const line = { event: name, at, ...fields };
		line.event = name;
		line.at = at;
		process.stdout.write(`${JSON.stringify(line)}\n`);
	} catch {
		// Logging is best effort.
	}
}
