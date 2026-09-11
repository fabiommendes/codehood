import type { Actor } from "@/core/actor";
import { FULL_ACCESS } from "@/core/actor";
import type { ServiceOpts } from "@/db/base-service";
import type { PrismaTx } from "@/db/client";

/**
 * Transient `fishery` params every `persisted*Factory` accepts: the
 * transaction to create the row in (so a test can roll it back) and the
 * actor to create it as.
 */
export interface PersistParams {
	tx?: PrismaTx;
	actor?: Actor;
}

/** Turns a factory's transient params into `ServiceOpts`, defaulting `actor` to `SYSTEM`. */
export function serviceOpts(params: PersistParams): ServiceOpts {
	return { tx: params.tx, actor: params.actor ?? FULL_ACCESS.actor };
}
