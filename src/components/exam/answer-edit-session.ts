import { AnswerEditAdapter } from "@/services/answer-edits/adapter";
import {
	AnswerEditCoordinator,
	type AttemptTransport,
	browserCoordinatorScheduler,
} from "@/services/answer-edits/coordinator";
import {
	createTextRecoveryStore,
	openIndexedDbEditStore,
} from "@/services/answer-edits/storage";

/// Loaded on demand by the exam page: nothing else imports it, so a page with the monitor off never fetches it.

/// The history stays in this browser until the server has an endpoint for it, so every network call fails at once.
const LOCAL_ONLY: AttemptTransport = {
	inspect: () => Promise.reject(new Error("The edit history is local only")),
	send: () => Promise.reject(new Error("The edit history is local only")),
};

/// Longest the final flush holds the submit button.
const FLUSH_CEILING_MS = 1500;

/**
 * Open the adapter that records the edit history of one attempt's text answers in this browser.
 *
 * Rejects when the browser storage cannot be opened; the caller treats that as "no history".
 */
export async function openAnswerEditSession(options: {
	ownerId: string;
	attemptId: string;
}): Promise<AnswerEditAdapter> {
	const { ownerId, attemptId } = options;
	const store = await openIndexedDbEditStore({ ownerId, indexedDB });
	const fallback = createTextRecoveryStore({ ownerId, storage: localStorage });
	const coordinator = new AnswerEditCoordinator({
		ownerId,
		attemptId,
		store,
		fallback,
		transport: LOCAL_ONLY,
		scheduler: browserCoordinatorScheduler(),
		now: () => Date.now(),
		monotonicNow: () => performance.now(),
		random: () => Math.random(),
		createSessionId: () => crypto.randomUUID(),
	});
	return new AnswerEditAdapter({
		coordinator,
		now: () => performance.now(),
		scheduler: browserCoordinatorScheduler(),
		createSessionId: () => crypto.randomUUID(),
		flushCeilingMs: FLUSH_CEILING_MS,
	});
}
