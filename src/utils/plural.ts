/**
 * Formats a count with the singular or plural form of a noun.
 *
 * @example
 * plural(1, "admin"); // "1 admin"
 * plural(2, "admin"); // "2 admins"
 * plural(2, "discipline", "disciplines");
 */
export function plural(count: number, one: string, many = `${one}s`): string {
	return `${count} ${count === 1 ? one : many}`;
}
