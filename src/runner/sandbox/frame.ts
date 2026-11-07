/**
 * Entry of the runner frame page, the document served at `/runner/frame`
 * on the runner origin.
 *
 * Student code never runs in this document: only in Workers it creates. The
 * frame handles a message only when `event.source === window.parent` and
 * `event.origin === appOrigin`; anything else (a popup, an opener, another
 * frame, the frame's own Workers through `window`) is dropped. It posts only
 * to `window.parent` with target origin `appOrigin`.
 *
 * The frame loads its scripts only from `/runner/<version>/`, never from
 * `/_astro/` or `public/`.
 */

/** Settings the server writes into the frame page. */
export interface FrameConfig {
	/// Origin of the app allowed to drive this frame (`PUBLIC_URL`).
	appOrigin: string;
	/// Absolute URL of the versioned bundle directory (`/runner/<version>/`).
	bundleBase: string;
	/// Announce the `fake` driver (every environment but production).
	withFake: boolean;
	/// At most one run at a time: a `run` while another is active ends at once
	/// with `crashed`. Set by `/runner/frame?exclusive=1`, which review mode uses.
	exclusive: boolean;
}

/// Deadline for one origin storage cleanup.
export const STORAGE_CLEANUP_TIMEOUT_MS = 2000;

/**
 * Boots the frame: starts the storage cleanup, picks the stdin transport,
 * starts listening to the app and posts `ready`, without waiting for the
 * cleanup.
 *
 * For each `run` it starts `clearOriginStorage` without waiting for it,
 * creates a module Worker from `${bundleBase}worker.js`, opens a stdin
 * channel and sends `start`. It forwards Worker messages that parse: output
 * in batches every `OUTPUT_FLUSH_MS`, a `status` only when the state
 * changes. It counts output bytes and output messages, and terminates the
 * Worker on `stop`, when either output limit is passed, or on the first
 * `exit` the Worker posts (student code can forge one); later messages from
 * that Worker are dropped. A `run` with a `runId` already used in this frame
 * load is ignored. Each accepted run ends with exactly one `exit`.
 */
export function startFrame(_config: FrameConfig): void {
	throw new Error("not implemented");
}

/**
 * Deletes every IndexedDB database, every Cache Storage cache and every
 * entry of the origin private file system of this origin, all in parallel,
 * giving up after `timeoutMs`.
 *
 * A database another context keeps open is left for a later cleanup instead
 * of being waited on. The service worker registration stays. Never rejects.
 */
export async function clearOriginStorage(_timeoutMs: number): Promise<void> {
	throw new Error("not implemented");
}
