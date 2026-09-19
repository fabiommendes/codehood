/** Formats a byte count as a short human string: `900 B`, `1.2 MB`, `3.4 GB`. */
export function formatBytes(bytes: number): string {
	const units = ["B", "KB", "MB", "GB"];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	const rounded = unit === 0 ? String(value) : value.toFixed(1);
	return `${rounded} ${units[unit]}`;
}

/**
 * Parses a human byte size such as `"200mb"` into a plain byte count.
 *
 * The inverse of {@link formatBytes}, so multiples are binary (`kb` = 1024)
 * and its output round-trips back. Suffixes are case-insensitive and
 * optional, a bare number already being a byte count. Throws on anything it
 * cannot read, since the only callers are environment variables read at boot.
 */
const BYTE_UNITS: Record<string, number> = {
	b: 1,
	kb: 1024,
	mb: 1024 ** 2,
	gb: 1024 ** 3,
};

export function parseByteSize(value: string): number {
	const match = value
		.trim()
		.toLowerCase()
		.match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/);
	if (!match) {
		throw new Error(`Invalid byte size: "${value}"`);
	}
	const [, amount, suffix] = match;
	// biome-ignore lint/style/noNonNullAssertion: suffix is undefined (defaulted to "b") or one of the regex's b|kb|mb|gb alternatives — always a BYTE_UNITS key.
	const unit = BYTE_UNITS[suffix ?? "b"]!;
	return Math.round(Number(amount) * unit);
}
