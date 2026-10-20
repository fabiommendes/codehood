/**
 * Server-side error serialization.
 *
 * Lives apart from `./error` because it reads `process.env` through
 * `@/core/constants`, which must not reach the browser.
 */
import * as env from "@/core/constants";
import { BaseSerializableError, RuleViolation } from "./error";
import type { ErrorResponse } from "./error-response";

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
