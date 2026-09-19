import { PrismaClientKnownRequestError } from "@prisma/client/runtime/client";
import type { z } from "zod";
import { DEVELOPMENT } from "@/core/constants";
import {
	type ActionCode,
	InvalidData,
	type InvalidDataErrors,
	NotAllowed,
	NotFound,
} from "@/core/error";
import type { InvalidDataCode } from "@/core/error-response";
import type { CourseId, courseNaturalKey } from "@/core/schemas";

/**
 * The unique-key `where` for a course given by id or by natural key.
 */
export function courseRefWhere(
	ref: z.infer<typeof courseNaturalKey> | CourseId | { courseId: CourseId },
) {
	if (typeof ref === "number") return { id: ref };
	if ("courseId" in ref) return { id: ref.courseId };

	return {
		disciplineSlug_instructorId_editionSlug: {
			disciplineSlug: ref.discipline,
			instructorId: ref.instructor,
			editionSlug: ref.edition,
		},
	};
}

/**
 * Ensure object exists or throw a NotFound error.
 *
 * The optional arguments are passed to the {@link NotFound} constructor.
 */
export function valueOrNotFound<T>(
	resource: string,
	value: T | null | undefined,
	args?: { id?: number | string; context?: string; message?: string },
): T {
	if (value === null || value === undefined) throw new NotFound(resource, args);
	return value;
}

/**
 * Return a value that follows predicate or throw a NotAllowed error.
 */
export function valueOrNotAllowed<T>(
	action: ActionCode,
	value: T,
	args?:
		| {
				target?: JSON;
				message?: string;
				status?: 403 | 401 | 409;
				pred?: (value: T) => boolean;
		  }
		| ((value: T) => boolean),
): T {
	if (typeof args === "function") args = { pred: args };
	ensureAllowed({ value, action, ...args });
	return value;
}

/**
 * Ensure value follows predicate or throw a NotAllowed error.
 *
 * Do not return the validated value.
 */
export function ensureAllowed<T>(args: {
	action: ActionCode;
	value: T;
	target?: JSON;
	message?: string;
	status?: 403 | 401 | 409;
	pred?: (value: T) => boolean;
}): void {
	const pred =
		args?.pred ??
		((v: T) => v !== null && v !== undefined && v !== 0 && v !== "");

	if (args.value === null || args.value === undefined || !pred(args.value))
		throw new NotAllowed(args.action, {
			status: args?.status,
			message: args?.message,
			target: args?.target,
		});
}

/// Type in errors for prisma SQLite driver adapter
type WithCause = {
	cause?: {
		originalCode: string;
		originalMesage: string;
		kind: string;
		constraint: { fields?: string[]; foreignKey?: object };
	};
};

/**
 * Called when an operation would fail if the resource already exists in
 * the database.
 *
 * Simple wrap the prisma call with this function so it redirect to the correct
 * exception, if necessary.
 *
 * @example
 * ```ts
 * const result = await invalidIfExists(client.course.create, {
 *   data: {
 *     slug: "example",
 *     name: "Example Course",
 *     startAt: new Date(),
 *     endAt: new Date(),
 *   },
 * });
 */
export async function invalidIfExists<P extends unknown[], R>(
	fn: (...args: P) => Promise<R>,
	...args: P
) {
	try {
		return await fn(...args);
	} catch (error) {
		if (error instanceof PrismaClientKnownRequestError) {
			throw convertPrismaError(error);
		}
		throw error;
	}
}

function convertPrismaError(error: PrismaClientKnownRequestError): InvalidData {
	const modelName = error.meta?.modelName ?? "DbEntity";

	// For SQLITE adapter, we can inspect the cause field of the driverAdapterError
	// This tells the field that failed a unique constraint. We try
	// to infer the field this way
	const cause = (error.meta?.driverAdapterError as WithCause)?.cause;
	const errors: InvalidDataErrors = {};
	let message = "An error occurred";

	switch (error.code) {
		// Trying to create a resource in a PK that already exists
		case "P2002": {
			const fields = cause?.constraint?.fields ?? ["pk"];
			const displayFields = fields.map(removeIdSuffix).join(", ");
			const error = {
				code: "not-unique" satisfies InvalidDataCode,
				message: `A ${modelName} exists with this primary key: ${displayFields}.`,
			} as const;
			message = `${modelName} already exists in the database`;

			errors.pk = [error];

			// biome-ignore lint/style/noNonNullAssertion: fields is never empty
			if (fields.length === 1) errors[fields[0]!] = [error];

			break;
		}

		// Foreign Key violation
		case "P2003": {
			// TODO: inspect prisma's foreign key relations for the model and report?
			message = `${modelName} is trying to access a parent resource that do not exist`;
			break;
		}

		default: {
			message = `A unknown error ocurred: ${error.code}`;
		}
	}

	if (DEVELOPMENT) {
		errors["debug"] = [
			{
				code: "debug",
				message: {
					model: modelName,
					code: error.code,
					message: error.message.trim(),
					...cause,
				} as unknown as string, // we cheat into thinking it is a string. Only works for debuging purposes
			},
		];
	}

	return new InvalidData(errors, { message });
}

/**
 * Utility that removes Slug and Id from the string suffix
 */
function removeIdSuffix(src: string) {
	return src.endsWith("Id")
		? src.slice(0, src.length - 2)
		: src.endsWith("Slug")
			? src.slice(0, src.length - 4)
			: src;
}
