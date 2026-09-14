/**
 * Register all RPC methods here.
 *
 * Importing this module is what populates the method registry: the endpoint
 * (`src/pages/rpc.ts`) and the document generators import it for that side
 * effect alone. A method module missing from this list exists in the source
 * and nowhere else.
 */

export * as cli from "./cli";
export * as debug from "./debug";
export * as health from "./health";
