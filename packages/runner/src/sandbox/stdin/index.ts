/**
 * Picks and opens the stdin transport.
 */

import type { StdinKind } from "../../protocol";
import { createSabWriter, openSabReader } from "./sab";
import { createSwWriter, openSwReader } from "./sw";
import type { StdinReader, StdinTransport, StdinWriter } from "./types";

/// Path of the runner's service worker script. Fixed across releases; its
/// content changes with each build so the browser updates it.
export const SW_SCRIPT_URL = "/runner/sw.js";

/// Scope of the runner's service worker.
export const SW_SCOPE = "/runner/";

/// How long the frame waits for its service worker to take control.
export const SW_READY_TIMEOUT_MS = 5000;

/**
 * Chooses the stdin transport for this frame load: `sab` when the frame is
 * `crossOriginIsolated`, else `sw` once a service worker controls the frame,
 * else `none`.
 *
 * Registers the service worker only on the `sw` path. Never rejects.
 */
export async function detectStdinKind(): Promise<StdinKind> {
	try {
		if (
			globalThis.crossOriginIsolated &&
			typeof SharedArrayBuffer !== "undefined"
		) {
			return "sab";
		}
		const container = navigator.serviceWorker;
		if (!container) return "none";
		const registration = await container.register(SW_SCRIPT_URL, {
			scope: SW_SCOPE,
			updateViaCache: "none",
		});
		if (!container.controller) {
			// Firefox leaves a frame loaded after the worker activated without a
			// controller (only the activation's `claim()` reaches it).
			registration.active?.postMessage({ type: "claim" });
			await new Promise<void>((resolve) => {
				const done = () => {
					clearTimeout(timer);
					container.removeEventListener("controllerchange", done);
					resolve();
				};
				const timer = setTimeout(done, SW_READY_TIMEOUT_MS);
				container.addEventListener("controllerchange", done);
				if (container.controller) done();
			});
		}
		return container.controller ? "sw" : "none";
	} catch {
		return "none";
	}
}

/**
 * Creates the frame's end of a new channel for one run.
 *
 * @throws {Error} when `kind` is `none`.
 */
export function createStdinWriter(kind: StdinKind, runId: string): StdinWriter {
	switch (kind) {
		case "sab":
			return createSabWriter();
		case "sw":
			return createSwWriter(runId);
		case "none":
			throw new Error("this browser cannot run code: no stdin channel");
	}
}

/** Opens the Worker's end of the channel described by `transport`. */
export function openStdinReader(transport: StdinTransport): StdinReader {
	return transport.kind === "sab"
		? openSabReader(transport.buffer)
		: openSwReader(transport.runId, transport.token);
}
