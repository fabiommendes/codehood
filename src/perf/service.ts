/**
 * Times service calls for `defineService`: two clock reads per call, and a
 * line in the log only for a call at or above `PERF.slowServiceMs`.
 */
import { logEvent } from "@/utils/log";
import { PERF } from "./config";
import { currentRequest, lastSeen, type RequestPerf, round } from "./state";

/// A service call being timed.
export interface ServiceCall {
	op: string;
	nested: boolean;
	actor: unknown;
	perf: RequestPerf | undefined;
	start: number;
}

/**
 * Starts timing the call `op`, or returns null when the log is off.
 *
 * `nested` tells a call made from inside another service, whose time the
 * outer call already includes.
 */
export function beginServiceCall(
	op: string,
	nested: boolean,
	actor: unknown,
): ServiceCall | null {
	if (!PERF.enabled) return null;
	const perf = currentRequest();
	if (perf) {
		if (!nested) perf.services++;
		lastSeen.request = perf;
	}
	lastSeen.op = op;
	return { op, nested, actor, perf, start: performance.now() };
}

/// `system`, `bot` or the role of a user actor.
function actorKind(actor: unknown): string {
	if (typeof actor === "symbol") return "system";
	const user = actor as { role?: string; bot?: string } | null | undefined;
	if (user?.bot) return "bot";
	return user?.role?.toLowerCase() ?? "unknown";
}

/** Closes `call` when `result` settles, without touching `result`. */
export function endServiceCall(
	call: ServiceCall,
	result: Promise<unknown>,
): void {
	const done = () => {
		const ms = performance.now() - call.start;
		const { perf } = call;
		if (perf && !call.nested && ms > perf.slowestMs) {
			perf.slowest = call.op;
			perf.slowestMs = ms;
		}
		if (ms >= PERF.slowServiceMs)
			logEvent("slow-service", {
				op: call.op,
				ms: round(ms),
				nested: call.nested,
				actor: actorKind(call.actor),
				id: perf?.id,
				route: perf?.route,
			});
	};
	result.then(done, done);
}
