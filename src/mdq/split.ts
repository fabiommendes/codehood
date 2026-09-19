/**
 * Splitting a question into the half a student may see and the half they may
 * not, and putting the two back together.
 *
 * The halves are stored in separate columns (`QuestionData.publicPayload` and
 * `privatePayload`) so a student-facing read never selects the answer key —
 * leaking it would take actively asking for the private column rather than
 * forgetting to strip a field.
 *
 * The two halves are complementary: no field lives in both, which is why
 * {@link mergeQuestion} treats a field present on both sides as a bug rather
 * than a precedence question.
 */
import { ImproperBehavior } from "@/core/error";
import type { JSONObject, JSONValue } from "@/typing/concrete-types";
import type { PublicQuestion } from "./public";
import { Question } from "./question";
import {
	type Question as QuestionDoc,
	questionSchema,
} from "./schemas-generated";

/**
 * The fields the public half leaves out, shaped like the document they came
 * from: `{ answerKey, choices: [{ score }, …] }` rather than a flat list.
 */
export type PrivatePayload = JSONObject;

/**
 * Splits an authored document into its public and private halves.
 *
 * Merging them back yields the document again, up to the normalization the
 * public representation performs: choice ids the author omitted are resolved,
 * a numeric domain the author left implicit is inferred, and a fill-in's
 * blanks come back in the order its stem refers to them.
 */
export function splitQuestion(document: QuestionDoc): {
	publicPayload: PublicQuestion;
	privatePayload: PrivatePayload;
} {
	const publicPayload = new Question(document).toPublic();
	const rest = complement(asJson(document), asJson(publicPayload));

	return { publicPayload, privatePayload: (rest ?? {}) as PrivatePayload };
}

/**
 * Reassembles a document from its two halves.
 *
 * Throws {@link ImproperBehavior} when both halves define the same field: the
 * split produces complementary halves, so an overlap means the stored rows
 * were not written by {@link splitQuestion}, and silently preferring one side
 * would hide that.
 */
export function mergeQuestion(
	publicPayload: JSONValue,
	privatePayload: JSONValue,
): QuestionDoc {
	const merged = mergeValues(
		asObject(publicPayload, "publicPayload"),
		asObject(privatePayload, "privatePayload"),
		"$",
	);
	return questionSchema.parse(merged);
}

//
// Auxiliary functions
//

/**
 * What `authored` carries and `published` does not.
 *
 * Returns `undefined` when the two agree, so a field the public half already
 * states in full is stored once.
 */
function complement(
	authored: JSONValue | undefined,
	published: JSONValue | undefined,
): JSONValue | undefined {
	if (published === undefined) return authored;

	if (Array.isArray(authored) && Array.isArray(published)) {
		return complementArray(authored, published);
	}

	if (isObject(authored) && isObject(published)) {
		const rest: JSONObject = {};
		for (const [key, value] of Object.entries(authored)) {
			const left = complement(value, published[key]);
			if (left !== undefined) rest[key] = left;
		}
		return Object.keys(rest).length > 0 ? rest : undefined;
	}

	return authored === published ? undefined : authored;
}

/**
 * Element-wise for a list the public half kept whole (choices), and keyed by
 * `id` for one it filtered or reordered (a fill-in's blanks).
 */
function complementArray(
	authored: JSONValue[],
	published: JSONValue[],
): JSONValue | undefined {
	if (authored.length === published.length) {
		const rest = authored.map(
			(item, i) => complement(item, published[i]) ?? {},
		);
		return rest.some((item) => Object.keys(item).length > 0) ? rest : undefined;
	}

	const byId = new Map(
		published.filter(isObject).map((item) => [String(item.id), item] as const),
	);
	const rest: JSONObject = {};
	for (const item of authored) {
		if (!isObject(item) || typeof item.id !== "string") {
			throw new ImproperBehavior(
				"A list the public half filtered must hold objects with an id.",
			);
		}
		const left = complement(item, byId.get(item.id));
		if (left !== undefined) rest[item.id] = left;
	}
	return Object.keys(rest).length > 0 ? rest : undefined;
}

function mergeValues(
	published: JSONValue | undefined,
	restricted: JSONValue | undefined,
	path: string,
): JSONValue {
	if (published === undefined) {
		if (restricted === undefined) {
			throw new ImproperBehavior(`Neither payload defines "${path}".`);
		}
		return restricted;
	}
	if (restricted === undefined) return published;

	if (Array.isArray(published)) {
		return mergeArray(published, restricted, path);
	}

	if (isObject(published) && isObject(restricted)) {
		const merged: JSONObject = { ...published };
		for (const [key, value] of Object.entries(restricted)) {
			merged[key] = mergeValues(published[key], value, `${path}.${key}`);
		}
		return merged;
	}

	throw new ImproperBehavior(
		`Both payloads define "${path}": the halves of a question are complementary.`,
	);
}

/** The mirror of {@link complementArray}: by position, or by `id`. */
function mergeArray(
	published: JSONValue[],
	restricted: JSONValue,
	path: string,
): JSONValue[] {
	if (Array.isArray(restricted)) {
		if (published.length !== restricted.length) {
			throw new ImproperBehavior(
				`"${path}" has ${published.length} public entries and ${restricted.length} private ones.`,
			);
		}
		return published.map((item, i) =>
			mergeValues(item, restricted[i], `${path}[${i}]`),
		);
	}

	if (!isObject(restricted)) {
		throw new ImproperBehavior(`Both payloads define "${path}".`);
	}

	const rest = { ...restricted };
	const merged = published.map((item) => {
		const id = isObject(item) ? item.id : undefined;
		if (typeof id !== "string") {
			throw new ImproperBehavior(`"${path}" holds an entry with no id.`);
		}
		const other = rest[id];
		delete rest[id];
		return mergeValues(item, other, `${path}.${id}`);
	});

	// Entries the public half dropped entirely — a fill-in blank its stem never
	// refers to — are private in full, and still part of the document.
	return [...merged, ...Object.values(rest)];
}

function isObject(value: JSONValue | undefined): value is JSONObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asObject(value: JSONValue, label: string): JSONObject {
	if (!isObject(value)) {
		throw new ImproperBehavior(`${label} is not an object.`);
	}
	return value;
}

/**
 * A validated document and its public representation are JSON by construction
 * — every field is a string, number, boolean or a list of them — which their
 * declared types do not say. This is the one place that asserts it.
 */
function asJson(value: QuestionDoc | PublicQuestion): JSONObject {
	return value as unknown as JSONObject;
}
