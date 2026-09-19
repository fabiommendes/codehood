/**
 * Types for concrete values, as opposed to the type-level utilities in
 * `index.ts`: shapes data actually has at runtime.
 */

/** Anything `JSON.stringify` round-trips unchanged. */
export type JSONValue =
	| string
	| number
	| boolean
	| null
	| JSONObject
	| JSONArray;

export interface JSONObject {
	[key: string]: JSONValue;
}

export interface JSONArray extends Array<JSONValue> {}

export interface ToJSON {
	toJSON(): JSONValue;
}

/** A JSON value, or something that knows how to become one. */
export type JSONable = JSONValue | ToJSON;
