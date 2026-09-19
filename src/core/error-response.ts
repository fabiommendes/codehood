import type { Perm } from "@/auth/permissions";
import type { JSONable, JSONValue, ToJSON } from "@/typing/concrete-types";

export type { JSONable, JSONValue } from "@/typing/concrete-types";

/**
 * Error responses describe the user-facing JSON that represents an error/exception.
 */
export type ErrorResponse =
	| InvalidDataResponse
	| NotAllowedResponse
	| NotFoundResponse
	| RuleViolationResponse
	| InternalErrorResponse
	| BadRequestResponse;

export interface BaseErrorResponse {
	type: "error";
	code: string;
	status: number;
	message: string;
	timestamp: Date;
}

/**
 * Error responses produced by validation errors.
 *
 * Usually they are captured from a zod validation error. It may contain a
 * partial view of the data and an object mapping error fields to the
 * corresponding errors.
 *
 * The special `$` fields designates the root object. I.e., it store global
 * error messages for the invalid object.
 */
export interface InvalidDataResponse extends BaseErrorResponse {
	code: "invalid-data";
	status: 400 | 422;
	data?: JSONable;
	errors: { [key: string]: { code: InvalidDataCode; message?: string }[] };
}

export type InvalidDataCode =
	| "missing"
	| "debug"
	| "not-allowed"
	| "not-exists"
	| "not-unique"
	| "invalid"
	| "too-long"
	| "too-short"
	| "too-common"
	| "compromised"
	| "pattern-mismatch"
	| "type-mismatch"
	| "custom";

/**
 * Reports a user that is not allowed to perform an action on a resource.
 *
 * Can optionally store the username of the user/actor that attempted the
 * action.
 */
export interface NotAllowedResponse extends BaseErrorResponse {
	code: "not-allowed";
	status: 401 | 403 | 409;
	action: NotAllowedAction;
	target?: JSONValue;
	actor?: string;
}

type CrudAction = "create" | "read" | "update" | "delete" | "run";
type Entity = string; // TODO: make it strict?

export type NotAllowedAction =
	| Perm
	| "auth.authenticated" // Flags for invalid access from non-authenticated users
	| `${Entity}.${CrudAction}`;

/**
 * The user request is invalid
 */
export interface BadRequestResponse extends BaseErrorResponse {
	code: "bad-request";
	status: 400 | 405 | 406 | 408;
}

/**
 * Reports a resource that was not found.
 *
 * It may contain the id/pk used to locate the resource. The resource type is
 * included in the `resource` field and should be a dash-case string identifying
 * the resource type (e.g. "user", "course", "enrollment", "api-key").
 */
export interface NotFoundResponse extends BaseErrorResponse {
	code: "not-found";
	status: 404;
	id: string | number;
	resource: string;
	context?: JSONValue;
}

/**
 * Flags an operation that was interrupted because it would violate some
 * internal business rule.
 *
 * This is generally should not be user-facing, but rather it exists to assert
 * some invariants in the code. Only shown in dev mode. Production convert them
 * to generic internal errors (status code 500).
 */
export interface RuleViolationResponse extends BaseErrorResponse {
	code: "rule-violation";
	status: 500;
	actor?: string;
	target?: JSONValue;
	info?: JSONValue;
}

/**
 * Generic internal error response. This is used when an unexpected error due
 * to exceptions that were never caught.
 *
 * Ideally we should never produce those errors in normal circumstances, but we
 * never know :)
 */
export interface InternalErrorResponse extends BaseErrorResponse {
	code: "internal-error";
	status: 500 | 501 | 503;
}

//
// Utility functions
//

/**
 * Converts an arbitrary value to a JSONValue, if possible.
 *
 * Returns undefined on failure.
 */
export function toJsonValueOrNothing(value: unknown): JSONValue | undefined {
	if (value === undefined || value === null) return undefined;

	const json = (value as Partial<ToJSON>).toJSON?.();
	if (json !== undefined) return json;

	// Try primitive types
	if (
		value === null ||
		typeof value === "boolean" ||
		typeof value === "number" ||
		typeof value === "string"
	) {
		return value as JSONValue;
	}

	// Try arrays
	if (Array.isArray(value)) {
		return value
			.map((item) => toJsonValueOrNothing(item))
			.filter((item) => item !== undefined);
	}

	// Try common instances
	if (value instanceof Date) {
		return value.toISOString();
	}

	if (typeof value === "object") {
		const result: Record<string, JSONValue> = {};

		for (const [k, v] of Object.entries(value)) {
			const jsonValue = toJsonValueOrNothing(v);
			if (jsonValue !== undefined) {
				result[k] = jsonValue;
			}
		}

		// If not a plain object, add a type parameter, it it does not exist already
		if (value.constructor !== Object.prototype.constructor) {
			result.type ??= value.constructor.name;
		}
		return result as JSONValue;
	}

	return undefined;
}
