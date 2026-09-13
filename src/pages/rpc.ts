import type { APIRoute } from "astro";
import type { UserActor } from "@/core/actor";
import { dispatch, RPC_ERROR, type RpcResponse } from "@/rpc/registry";

// Importing the method index is what registers the methods.
import "@/rpc";

export const prerender = false;

/**
 * `POST /rpc` — the JSON-RPC 2.0 endpoint.
 *
 * Authentication is the same as everywhere else: `sessionMiddleware` and
 * `apiKeyMiddleware` have already put an actor on `locals` if the request
 * carried a cookie or a `Bearer` key, so a browser and the CLI reach this the
 * same way. A batch runs entirely under that one actor.
 *
 * The HTTP status is 200 for everything the envelope can describe, including
 * method errors — a non-200 here means the body is not a JSON-RPC message at
 * all.
 */
export const POST: APIRoute = async ({ request, locals }) => {
	const actor = locals.actor as UserActor | undefined;

	let payload: unknown;
	try {
		payload = await request.json();
	} catch {
		return Response.json(
			{
				jsonrpc: "2.0",
				id: null,
				error: { code: RPC_ERROR.parse, message: "Invalid JSON." },
			},
			{ status: 400 },
		);
	}

	if (Array.isArray(payload)) {
		if (payload.length === 0)
			return Response.json(
				{
					jsonrpc: "2.0",
					id: null,
					error: {
						code: RPC_ERROR.invalidRequest,
						message: "A batch must contain at least one request.",
					},
				},
				{ status: 200 },
			);

		// Sequentially, not in parallel: the calls in a batch share a database
		// and an actor, and a client that wanted them to race could have sent
		// them as separate requests.
		const responses: RpcResponse[] = [];
		for (const item of payload) {
			const response = await dispatch(item, actor);
			if (response) responses.push(response);
		}
		return responses.length === 0
			? new Response(null, { status: 204 })
			: Response.json(responses);
	}

	const response = await dispatch(payload, actor);
	return response
		? Response.json(response)
		: new Response(null, { status: 204 });
};

/**
 * Anything that is not a POST. JSON-RPC has exactly one verb, and answering a
 * `GET /rpc` with Astro's default 404 would suggest the endpoint is missing.
 */
export const ALL: APIRoute = () =>
	Response.json(
		{
			jsonrpc: "2.0",
			id: null,
			error: {
				code: RPC_ERROR.invalidRequest,
				message: "The RPC endpoint only accepts POST.",
			},
		},
		{ status: 405, headers: { allow: "POST" } },
	);
