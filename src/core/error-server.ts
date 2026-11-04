/**
 * Server-side error serialization.
 *
 * Lives apart from `./error` because it reads `process.env` through
 * `@/core/constants`, which must not reach the browser.
 */
import * as env from "@/core/constants";
import { m } from "@/i18n";
import { BaseSerializableError, RuleViolation } from "./error";
import type { ErrorResponse } from "./error-response";

/**
 * Convert exceptions to a user-facing error response.
 *
 * Codehood defines a few different types of user-facing errors. Anything else,
 * and a {@link RuleViolation}, is a bug on the server: in production it
 * becomes a bare 500 whose message says nothing about the exception, which is
 * logged instead. Elsewhere the message is passed through to help debugging.
 */
export function responseFromException(
	error: unknown,
	production: boolean = env.PRODUCTION,
): ErrorResponse {
	const internal =
		error instanceof RuleViolation || !(error instanceof BaseSerializableError);
	if (internal && production) {
		console.error(error);
		return {
			type: "error",
			code: "internal-error",
			status: 500,
			message: m.errors_internal(),
			timestamp: new Date(),
		};
	}
	if (error instanceof BaseSerializableError) return error.toJSON();
	if (error instanceof Error) {
		return {
			type: "error",
			code: "internal-error",
			status: 500,
			message: error.message,
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
