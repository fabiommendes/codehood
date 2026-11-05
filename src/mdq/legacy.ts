/**
 * Reading question versions stored by Codehood 0.2.
 *
 * Up to 0.2 a version kept two complementary halves: `publicPayload` held
 * what a student may see and `privatePayload` only what that leaves out (the
 * answer key, per-choice scores and feedback), shaped like the document
 * (`{ choices: [{ score }, …] }`, or keyed by id for a list the public half
 * filtered). The documents also followed an older mdq spec, with `preamble`,
 * essay `input` and short answer `oneOf`.
 */
import type { JSONObject, JSONValue } from "@/typing/concrete-types";
import { type QuestionDocument, questionDocument, withIds } from "./index";

/**
 * Rebuilds the current document of a version stored in the 0.2 split, or
 * returns `null` when `privatePayload` already holds a whole current document.
 *
 * @throws {Error} When the halves do not merge, or the merged document is not
 * a valid question of the current spec.
 */
export function upgradeLegacyQuestion(
	publicPayload: JSONValue,
	privatePayload: JSONValue,
): QuestionDocument | null {
	if (questionDocument.safeParse(privatePayload).success) return null;

	const merged = mergeValues(publicPayload, privatePayload, "$");
	if (!isObject(merged)) throw new Error("A question must be an object.");
	const parsed = questionDocument.safeParse(renameFields(merged));
	if (!parsed.success) {
		const issues = parsed.error.issues.map(
			(issue) => `${issue.path.join(".") || "$"}: ${issue.message}`,
		);
		throw new Error(issues.join("; "));
	}
	return withIds(parsed.data);
}

//
// Auxiliary functions
//

/// Maps the fields of the older spec onto the current ones.
function renameFields(document: JSONObject): JSONObject {
	const { preamble, input, oneOf, ...rest } = document;
	const result: JSONObject = { ...rest };
	if (typeof preamble === "string" && preamble.trim()) {
		result.stem = `${preamble}\n\n${result.stem}`;
	}
	if (input !== undefined) result.content = input;
	if (oneOf !== undefined) result.accept = result.accept ?? oneOf;
	if (Array.isArray(result.blanks)) {
		result.blanks = result.blanks.map((blank) => {
			if (!isObject(blank) || blank.oneOf === undefined) return blank;
			const { oneOf: list, ...other } = blank;
			return { ...other, accept: other.accept ?? list };
		});
	}
	return result;
}

/// Merges the public half with the private one: field by field, lists by
/// position, or by `id` when the private half keys them.
function mergeValues(
	published: JSONValue | undefined,
	restricted: JSONValue | undefined,
	path: string,
): JSONValue {
	if (published === undefined) {
		if (restricted === undefined) {
			throw new Error(`Neither half defines "${path}".`);
		}
		return restricted;
	}
	if (restricted === undefined) return published;
	if (Array.isArray(published)) return mergeArray(published, restricted, path);
	if (isObject(published) && isObject(restricted)) {
		const merged: JSONObject = { ...published };
		for (const [key, value] of Object.entries(restricted)) {
			merged[key] = mergeValues(published[key], value, `${path}.${key}`);
		}
		return merged;
	}
	throw new Error(`Both halves define "${path}".`);
}

/// The list case of {@link mergeValues}.
function mergeArray(
	published: JSONValue[],
	restricted: JSONValue,
	path: string,
): JSONValue[] {
	if (Array.isArray(restricted)) {
		if (published.length !== restricted.length) {
			throw new Error(`"${path}" has halves of different lengths.`);
		}
		return published.map((item, i) =>
			mergeValues(item, restricted[i], `${path}[${i}]`),
		);
	}
	if (!isObject(restricted)) throw new Error(`Both halves define "${path}".`);

	const rest = { ...restricted };
	const merged = published.map((item) => {
		const id = isObject(item) ? item.id : undefined;
		if (typeof id !== "string") {
			throw new Error(`"${path}" holds an entry with no id.`);
		}
		const other = rest[id];
		delete rest[id];
		return mergeValues(item, other, `${path}.${id}`);
	});
	// Entries the public half dropped whole are private in full.
	return [...merged, ...Object.values(rest)];
}

function isObject(value: JSONValue | undefined): value is JSONObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
