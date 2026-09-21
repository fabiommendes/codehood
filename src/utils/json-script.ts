/**
 * Serializes `value` for the body of a `<script type="application/json">`.
 *
 * `JSON.stringify` alone is not safe there. It leaves `</script` intact, and
 * the HTML parser closes a script element on that sequence whatever the
 * element's `type` says, so everything after it is parsed as markup — a name
 * of `</script><img src=x onerror=...>` becomes script execution on the page
 * that embeds it. Escaping `<` as `\u003c` produces a string `JSON.parse`
 * reads back identically while never closing the element. U+2028 and U+2029
 * go the same way: legal in JSON, but line terminators in JavaScript source.
 *
 * @example
 * jsonScriptPayload(["</script>"]) === '["\\u003c/script>"]'
 */
export function jsonScriptPayload(value: unknown): string {
	return JSON.stringify(value)
		.replaceAll("<", "\\u003c")
		.replaceAll("\u2028", "\\u2028")
		.replaceAll("\u2029", "\\u2029");
}
