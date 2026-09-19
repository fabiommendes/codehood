import { type ZodType, z } from "zod";
import type { UserActor } from "@/auth/actor";
import { InvalidData, NotAllowed, responseFromException } from "@/core/error";
import type { ErrorResponse } from "@/core/error-response";

/// Actor = User? or User depending if the method is public or not.
type MaybeActor<IsPublic> = IsPublic extends false
	? UserActor
	: UserActor | undefined;

/**
 * Options for {@link METHOD}, the RPC counterpart of `RouteOptions`.
 *
 * There is no `params`: a method has no path, so the only input is `params`
 * on the wire, which arrives as the handler's `body`.
 */
export type MethodOptions<In, Out, IsPublic extends boolean = false> = {
	isPublic?: IsPublic;
	in?: ZodType<In>;
	out: ZodType<Out>;
	summary?: string;
	description?: string;
	tags: string[];
	handler: (args: {
		actor: MaybeActor<IsPublic>;
		body: In extends { [key: string]: unknown } ? In : undefined;
	}) => Promise<Out>;
};

/** A method as the dispatcher and the document generators see it. */
export type RpcMethod = {
	name: string;
	isPublic: boolean;
	in?: ZodType<unknown>;
	out: ZodType<unknown>;
	summary?: string;
	description?: string;
	tags: string[];
	handler: (args: {
		actor: UserActor | undefined;
		body: unknown;
	}) => Promise<unknown>;
};

const METHODS = new Map<string, RpcMethod>();

/**
 * Registers a JSON-RPC method and returns its handler unchanged.
 *
 * The returned function is the handler itself, so server-side callers can use
 * a method directly without going through the wire format.
 */
export function METHOD<In, Out, IsPublic extends boolean = false>(
	name: `${string}.${string}`,
	options: MethodOptions<In, Out, IsPublic>,
) {
	if (METHODS.has(name))
		throw new Error(`RPC method "${name}" is registered twice.`);
	METHODS.set(name, {
		name,
		isPublic: options.isPublic ?? false,
		in: options.in as ZodType<unknown> | undefined,
		out: options.out as ZodType<unknown>,
		summary: options.summary,
		description: options.description,
		tags: options.tags,
		handler: options.handler as RpcMethod["handler"],
	});
	return options.handler;
}

/** Every registered method, keyed by name. */
export function getMethods(): ReadonlyMap<string, RpcMethod> {
	return METHODS;
}

/**
 * JSON-RPC error codes.
 *
 * `-32768..-32000` is the reserved range: the five codes below `-32000` are
 * the ones the spec defines, the rest are Codehood's, one per `code` that
 * `responseFromException` can produce.
 */
export const RPC_ERROR = {
	parse: -32700,
	invalidRequest: -32600,
	methodNotFound: -32601,
	invalidParams: -32602,
	internal: -32603,
	domain: -32000,
	unauthenticated: -32001,
	forbidden: -32002,
	notFound: -32003,
} as const;

export type RpcErrorObject = {
	code: number;
	message: string;
	data?: unknown;
};

export type RpcResponse = {
	jsonrpc: "2.0";
	id: string | number | null;
	result?: unknown;
	error?: RpcErrorObject;
};

/**
 * The envelope, validated before the method name is even looked at.
 *
 * `params` stays `unknown` here: which schema it has to satisfy depends on the
 * method, and reporting "no such method" is more useful than reporting that
 * the params of a method that does not exist are wrong.
 */
const requestSchema = z.object({
	jsonrpc: z.literal("2.0"),
	method: z.string(),
	params: z.unknown().optional(),
	id: z.union([z.string(), z.number(), z.null()]).optional(),
});

/**
 * Runs one JSON-RPC request and returns the response object, or `null` when
 * the request is a notification (no `id`) and therefore has no response.
 *
 * Never throws: everything a caller can be told about is a response object.
 */
export async function dispatch(
	payload: unknown,
	actor: UserActor | undefined,
): Promise<RpcResponse | null> {
	const request = requestSchema.safeParse(payload);
	if (!request.success) {
		const id = idOf(payload);
		return {
			jsonrpc: "2.0",
			id,
			error: {
				code: RPC_ERROR.invalidRequest,
				message: "Not a JSON-RPC 2.0 request object.",
				data: InvalidData.fromZodError(request.error, payload).toJSON(),
			},
		};
	}

	// A notification is still executed; only its answer is dropped. That
	// includes its errors, which is what the spec asks for.
	const isNotification = request.data.id === undefined;
	const id = request.data.id ?? null;
	const respond = (response: Omit<RpcResponse, "jsonrpc" | "id">) =>
		isNotification ? null : { jsonrpc: "2.0" as const, id, ...response };

	const method = METHODS.get(request.data.method);
	if (!method)
		return respond({
			error: {
				code: RPC_ERROR.methodNotFound,
				message: `No such method: "${request.data.method}".`,
			},
		});

	// The authentication gate runs before the handler and before params are
	// validated, so an anonymous caller cannot use error messages to probe the
	// shape of a method they may not call.
	if (!method.isPublic && !actor)
		return respond({
			error: errorObject(
				new NotAllowed(`${method.name}.run`, {
					status: 401,
					message: "This method requires authentication.",
				}),
			),
		});

	try {
		return respond({ result: await run(method, request.data.params, actor) });
	} catch (error) {
		return respond({ error: errorObject(error) });
	}
}

/** Validates params against the method's schema and calls the handler. */
async function run(
	method: RpcMethod,
	params: unknown,
	actor: UserActor | undefined,
): Promise<unknown> {
	// Every handler validates against a Zod object, and there is no stable
	// argument order to map an array onto, so by-position params are refused
	// rather than guessed at.
	if (Array.isArray(params))
		throw new InvalidData(
			{},
			{ message: "Positional params are not supported; use an object." },
		);

	if (!method.in) return method.handler({ actor, body: undefined });

	const validated = method.in.safeParse(params ?? {});
	if (validated.error)
		throw InvalidData.fromZodError(validated.error, validated.data);
	return method.handler({ actor, body: validated.data });
}

/**
 * Turns a thrown error into a JSON-RPC error object.
 *
 * The mapping is the only RPC-specific part: the payload itself is what the
 * REST API would have returned as a body, carried whole in `data` so a client
 * that understands Codehood errors loses nothing by calling over RPC.
 */
export function errorObject(error: unknown): RpcErrorObject {
	const response = responseFromException(error);
	return {
		code: codeFor(response),
		message: response.message,
		data: response,
	};
}

function codeFor(response: ErrorResponse): number {
	switch (response.code) {
		case "invalid-data":
			return RPC_ERROR.invalidParams;
		case "not-found":
			return RPC_ERROR.notFound;
		case "not-allowed":
			return response.status === 401
				? RPC_ERROR.unauthenticated
				: RPC_ERROR.forbidden;
		case "internal-error":
		case "rule-violation":
			return RPC_ERROR.internal;
		default:
			return RPC_ERROR.domain;
	}
}

/**
 * Best-effort `id` of a request that failed to parse.
 *
 * The spec wants the id echoed even on an invalid request, and the id is
 * usable whenever it happens to be well-formed, whatever else is wrong.
 */
function idOf(payload: unknown): string | number | null {
	const id = (payload as { id?: unknown } | null)?.id;
	return typeof id === "string" || typeof id === "number" ? id : null;
}
