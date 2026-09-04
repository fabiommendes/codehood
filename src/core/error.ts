import type { z } from "zod";
import * as env from "@/core/constants";

interface ToJSON {
	toJSON(): JSON;
}
type JSONable = JSON | ToJSON;

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

interface BaseErrorResponse {
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
	errors: { [key: string]: { code: ValidationErrorCode; message?: string }[] };
}

type ValidationErrorCode =
	| "missing"
	| "not-allowed"
	| "invalid"
	| "too-long"
	| "too-short"
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
	action: ActionCode;
	target?: JSON;
	actor?: string;
}

type ActionCodeAction = "create" | "read" | "update" | "delete" | "do";
type ActionCode = `${ActionCodeAction}-${string}`;

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
	context?: string;
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
	target?: JSON;
	info?: JSON;
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
// Error classes
//

/**
 * Base Codehood error.
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
		const grouped: InvalidDataResponse["errors"] = {};
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
		return new InvalidData({
			errors: grouped,
			data: item as JSONable,
			status,
			message,
		});
	}

	constructor(args: {
		errors: InvalidDataResponse["errors"];
		data?: InvalidDataResponse["data"];
		message?: string;
		status?: number;
	}) {
		const { errors, data, message = "Validation Error", status = 400 } = args;
		super(message, "invalid-data", status);
		this.errors = errors;
		this.data = data;
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
}

/**
 * Thrown when a resource is not found.
 */
export class NotFound extends BaseSerializableError<NotFoundResponse> {
	readonly code = "not-found";
	readonly status: 404 = 404;
	readonly id: string | number;
	readonly context?: string;
	readonly resource: string;

	constructor(args: {
		resource: string;
		message?: string;
		id?: string | number;
		context?: string;
	}) {
		const {
			resource,
			message = "Resource not found",
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
		context?: string;
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
	readonly action: ActionCode;
	readonly target?: JSON;
	readonly actor?: string;

	constructor(args: {
		action: ActionCode;
		message?: string;
		status?: 403 | 401 | 409;
		target?: JSON;
	}) {
		const {
			action,
			message = "Permission denied",
			status = 403,
			target,
		} = args;
		super(message, "not-allowed", status);
		this.action = action;
		this.target = target;
		this.status = status;
	}

	protected _toJsonExtra(): {
		action: ActionCode;
		target?: JSON;
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
	readonly target?: JSON;
	readonly info?: JSON;

	constructor(args: {
		message?: string;
		actor?: string;
		target?: JSON;
		info?: JSON;
	}) {
		const { message = "Rule violation", actor, target, info } = args;
		super(message, "rule-violation", 500);
		this.actor = actor;
		this.target = target;
		this.info = info;
	}

	protected _toJsonExtra(): {
		actor?: string;
		target?: JSON;
		info?: JSON;
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

//
// Utility functions
//

/**
 * Maps a Zod issue to the coarser {@link ValidationErrorCode} the API exposes.
 */
function validationErrorCodeFromZodIssue(
	issue: z.core.$ZodIssue,
): ValidationErrorCode {
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
