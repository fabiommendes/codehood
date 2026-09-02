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
