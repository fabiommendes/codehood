/**
 * Core Codehood exceptions
 */
import type { z } from "zod";
import * as env from "@/core/constants";
import {
	type BaseErrorResponse,
	type ErrorResponse,
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
		const message = args?.message ?? "Validation Error";
		super(message, "invalid-data", args?.status ?? 400);

		errors = { ...errors };
		delete errors.$;

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

		const { message = "Resource not found", id = "unknown", context } = args;
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
		const { message = "Permission denied", status = 403, target } = args ?? {};
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
		const { message = "Rule violation", actor, target, info } = args;
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
			message: `Rule violation: ${message}`,
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

	constructor(message: string = "Service unavailable") {
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
 * Convert exceptions to a user-facing error response.
 *
 * Codehood defines a few different types of user-facing errors. Most of the
 * other errors should be treated as generic 500 internal server errors, and the
 * details of the exception should not be exposed to the user.
 */
export function responseFromException(error: unknown): ErrorResponse {
	if (error instanceof RuleViolation && env.PRODUCTION)
		return error.toInternalErrorResponse();
	if (error instanceof BaseSerializableError) return error.toJSON();
	if (error instanceof Error) {
		const exception = error as Error;
		return {
			type: "error",
			code: "internal-error",
			status: 500,
			message: exception.message,
			timestamp: new Date(),
		};
	}

	// biome-ignore lint/suspicious/noExplicitAny: we don't know what the error is, so we have to use `any` here
	const arbitrary = error as any;
	return {
		type: "error",
		code: arbitrary?.code ?? "internal-error",
		status: arbitrary?.status ?? 500,
		message: String(error),
		timestamp: new Date(),
	};
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
