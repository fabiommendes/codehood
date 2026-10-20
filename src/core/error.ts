/**
 * Core Codehood exceptions
 */
import type { z } from "zod";
import { m } from "@/i18n";
import {
	type BaseErrorResponse,
	type InternalErrorResponse,
	type InvalidDataCode,
	type InvalidDataResponse,
	type JSONable,
	type JSONValue,
	type NotAllowedAction,
	type NotAllowedResponse,
	type NotFoundResponse,
	type RuleViolationResponse,
	toJsonValueOrNothing,
} from "./error-response";

export type {
	JSONValue,
	NotAllowedAction as ActionCode,
} from "./error-response";

/**
 * Thrown when hitting non-implemented methods and functions.
 */
export class NotImplemented extends Error {}

/**
 * Thrown when the code reaches some supposedly unreacheable state.
 *
 * This flags bugs in the code that should never occur.
 */
export class ImproperBehavior extends Error {
	static assert<B extends true>(
		cond: B | false,
		msg?: string | (() => string),
	): asserts cond is B {
		if (!cond)
			throw new ImproperBehavior(typeof msg === "function" ? msg() : msg);
	}
}

/**
 * Thrown when the global configuration is inconsistent.
 *
 * Throw this instead of ImproperBehavior when the source of error is a
 * misconfiguration in the global settings rathen than a bug in the code.
 */
export class ImproperConfiguration extends Error {
	static assert<B extends true>(
		cond: B | false,
		msg?: string | (() => string),
	): asserts cond is B {
		if (!cond)
			throw new ImproperConfiguration(typeof msg === "function" ? msg() : msg);
	}
}

/**
 * Base Codehood user-facing error.
 *
 * Abstract class, never create instances.
 */
export class BaseSerializableError<T extends BaseErrorResponse> extends Error {
	readonly code: string;
	readonly status: number;

	constructor(message: string, code: string, status: number) {
		super(message);
		this.code = code;
		this.status = status;
	}

	toJSON(): T {
		return {
			type: "error",
			code: this.code,
			status: this.status,
			timestamp: new Date(),
			message: this.message,
			...this._toJsonExtra(),
		} as T;
	}

	protected _toJsonExtra(): Omit<
		T,
		"type" | "code" | "status" | "timestamp" | "message"
	> {
		throw Error("toJsonExtra() must be implemented in subclasses");
	}
}

/**
 * Thrown when the user submits invalid data.
 */
export class InvalidData extends BaseSerializableError<InvalidDataResponse> {
	readonly code = "invalid-data";
	readonly errors: InvalidDataResponse["errors"];
	readonly target?: InvalidDataResponse["data"];
	readonly data?: InvalidDataResponse["data"];

	static fromZodError(
		error: z.ZodError,
		item?: unknown,
		status: number = 400,
	): InvalidData {
		const grouped: InvalidDataErrors = {};
		const summaries: string[] = [];
		for (const issue of error.issues) {
			const key = issue.path.length > 0 ? issue.path.join(".") : "$";
			grouped[key] = grouped[key] ?? [];
			grouped[key].push({
				code: validationErrorCodeFromZodIssue(issue),
				message: issue.message,
			});
			summaries.push(key === "$" ? issue.message : `${key}: ${issue.message}`);
		}
		const message = summaries.length > 0 ? summaries.join("; ") : undefined;
		return new InvalidData(grouped, {
			data: item as JSONable,
			status,
			message,
		});
	}

	constructor(
		errors: {
			[key: string]: InvalidDataResponse["errors"][string] | undefined | null;
		},
		args?: {
			data?: InvalidDataResponse["data"];
			message?: string;
			status?: number;
		},
	) {
		const message = args?.message ?? summarizeErrors(errors);
		super(message, "invalid-data", args?.status ?? 400);

		errors = { ...errors };

		this.errors = {};
		for (const [k, v] of Object.entries(errors)) {
			if (v && v.length > 0) {
				this.errors[k] = v;
			}
		}
		this.data = args?.data;
	}

	protected _toJsonExtra(): {
		errors: InvalidDataResponse["errors"];
		data?: InvalidDataResponse["data"];
	} {
		return {
			errors: this.errors,
			data: this.data,
		};
	}

	/**
	 * Throws an InvalidData error if any of the provided errors are non-empty.
	 */
	static ensureNoError(
		errors: {
			[key: string]: InvalidDataResponse["errors"][string] | undefined | null;
		},
		args?: {
			data?: InvalidDataResponse["data"];
			message?: string;
			status?: number;
		},
	) {
		for (const v of Object.values(errors)) {
			if (v && v.length > 0) {
				throw new InvalidData(errors, args);
			}
		}
	}

	/**
	 * Ensure object is a valid Zod parsed result.
	 *
	 * Throws an InvalidData error if the parsed result is invalid.
	 */
	static zodValidate<T>(parsed: z.ZodSafeParseResult<T>) {
		if (parsed.success) return parsed.data;
		throw InvalidData.fromZodError(parsed.error);
	}
}

export type InvalidDataErrors = InvalidDataResponse["errors"];

/**
 * Thrown when a resource is not found.
 *
 * ```typescript
 *
 * throw new NotFound("user", { id: username })
 * ```
 */
export class NotFound extends BaseSerializableError<NotFoundResponse> {
	readonly code = "not-found";
	readonly status: 404 = 404;
	readonly id: string | number;
	readonly context?: JSONValue;
	// TODO: define ResourceType enum
	readonly resource: string;

	constructor(
		resource: string,
		args?:
			| {
					message?: string;
					id?: string | number;
					context?: JSONValue;
			  }
			| string
			| number,
	) {
		if (typeof args === "string" || typeof args === "number") {
			args = { id: args };
		} else if (args === undefined) {
			args = {};
		}

		const {
			message = m.errors_resource_not_found(),
			id = "unknown",
			context,
		} = args;
		super(message, "not-found", 404);
		this.resource = resource;
		this.id = id;
		this.context = context;
	}

	protected _toJsonExtra(): {
		id: string | number;
		resource: string;
		context?: JSONValue;
	} {
		return {
			id: this.id,
			resource: this.resource,
			context: this.context,
		};
	}
}

/**
 * Thrown when the user is not allowed to perform an action on a resource.
 */
export class NotAllowed extends BaseSerializableError<NotAllowedResponse> {
	readonly code = "not-allowed";
	readonly status: 403 | 401 | 409;
	readonly action: NotAllowedAction;
	readonly target?: JSONValue;
	readonly actor?: string;

	constructor(
		action: NotAllowedAction,
		args?: {
			message?: string;
			status?: 403 | 401 | 409;
			target?: unknown;
		},
	) {
		const {
			message = m.errors_permission_denied(),
			status = 403,
			target,
		} = args ?? {};
		super(message, "not-allowed", status);
		this.action = action;
		this.target = toJsonValueOrNothing(target);
		this.status = status;
	}

	/**
	 * Returns a copy of this error re-tagged with a different action.
	 *
	 * Lets a caller report the operation the actor asked for rather than the
	 * internal step that refused it.
	 */
	as(action: NotAllowedAction): NotAllowed {
		return new NotAllowed(action, {
			message: this.message,
			status: this.status,
			target: this.target,
		});
	}

	protected _toJsonExtra(): {
		action: NotAllowedAction;
		target?: JSONValue;
	} {
		return {
			action: this.action,
			target: this.target,
		};
	}
}

/**
 * Thrown when an operation would violate a internal business rule.
 */
export class RuleViolation extends BaseSerializableError<RuleViolationResponse> {
	readonly code = "rule-violation";
	readonly status: 500 = 500;
	readonly actor?: string;
	readonly target?: JSONValue;
	readonly info?: JSONValue;

	constructor(args: {
		message?: string;
		actor?: string;
		target?: JSONValue;
		info?: JSONValue;
	}) {
		const { message = m.errors_rule_violation(), actor, target, info } = args;
		super(message, "rule-violation", 500);
		this.actor = actor;
		this.target = target;
		this.info = info;
	}

	protected _toJsonExtra(): {
		actor?: string;
		target?: JSONValue;
		info?: JSONValue;
	} {
		return {
			actor: this.actor,
			target: this.target,
			info: this.info,
		};
	}

	toInternalErrorResponse(): InternalErrorResponse {
		const { message } = this;
		return {
			type: "error",
			code: "internal-error",
			status: 500,
			message: m.errors_rule_violation_internal({ message }),
			timestamp: new Date(),
		};
	}
}

/**
 * Thrown when the server is up but a dependency it needs is not.
 *
 * The caller did nothing wrong and the request may well succeed later, which
 * is what separates this from every other 500: retrying is the right move.
 */
export class Unavailable extends BaseSerializableError<InternalErrorResponse> {
	readonly code = "internal-error";
	readonly status: 503 = 503;

	constructor(message: string = m.errors_service_unavailable()) {
		super(message, "internal-error", 503);
	}

	protected _toJsonExtra(): Record<string, never> {
		return {};
	}
}

//
// Utility functions
//

/**
 * Raise an error type constructed with the given parameters.
 *
 * This is useful to throw exceptions in places that expect expressions instead
 * of statements.
 */
export function raise(err: Error) {
	throw err;
}

/**
 * Maps a Zod issue to the coarser {@link InvalidDataCode} the API exposes.
 */
function validationErrorCodeFromZodIssue(
	issue: z.core.$ZodIssue,
): InvalidDataCode {
	switch (issue.code) {
		case "invalid_type":
			return issue.input === undefined ? "missing" : "type-mismatch";
		case "too_big":
			return "too-long";
		case "too_small":
			return "too-short";
		case "invalid_format":
			return "pattern-mismatch";
		case "unrecognized_keys":
			return "not-allowed";
		case "custom":
			return "custom";
		default:
			return "invalid";
	}
}

/// Renders field errors as `field: message; field: message`, mirroring the
/// summary `InvalidData.fromZodError` builds, so a hand-built error is not
/// reduced to a bare m.errors_validation().
function summarizeErrors(errors: {
	[key: string]: InvalidDataResponse["errors"][string] | undefined | null;
}): string {
	const summaries: string[] = [];
	for (const [key, issues] of Object.entries(errors)) {
		for (const issue of issues ?? []) {
			if (!issue.message) continue;
			summaries.push(key === "$" ? issue.message : `${key}: ${issue.message}`);
		}
	}
	return summaries.length > 0 ? summaries.join("; ") : m.errors_validation();
}

/**
 * Thrown when a service rejects the value of one form field.
 *
 * For rules only the server can check (a taken slug), so the message reaches
 * the field instead of the top of the form.
 */
export class FieldError extends Error {
	constructor(
		readonly field: string,
		message: string,
	) {
		super(message);
		this.name = "FieldError";
	}
}

/**
 * Thrown when a roll call check-in is refused.
 */
export class CheckInError extends Error {
	constructor(
		readonly code:
			| "invalid-code"
			| "expired"
			| "closed"
			| "not-enrolled"
			| "dropped"
			| "not-student"
			| "claim-expired",
		message: string = m.errors_check_in_refused({ code }),
	) {
		super(message);
		this.name = "CheckInError";
	}
}
