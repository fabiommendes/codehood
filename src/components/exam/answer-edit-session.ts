import {
	answerEditAppendResult,
	answerEditInspectResult,
} from "@/core/schemas/answer-edit";
import { AnswerEditAdapter } from "@/services/answer-edits/adapter";
import {
	AnswerEditCoordinator,
	type AttemptTransport,
	browserCoordinatorScheduler,
	type FieldResult,
} from "@/services/answer-edits/coordinator";
import { openIndexedDbEditStore } from "@/services/answer-edits/storage";

/// Loaded on demand by the exam page: nothing else imports it, so a page with the monitor off never fetches it.

/// The slice of `actions.answerHistory` the transport calls; the page injects it so this module never imports `astro:actions`.
export interface AnswerHistoryActions {
	inspect(input: Record<string, unknown>): Promise<ActionOutcome>;
	send(input: Record<string, unknown>): Promise<ActionOutcome>;
}

/// What an Astro action resolves to: the data or an error with a code.
interface ActionOutcome {
	readonly data?: unknown;
	readonly error?: { readonly code?: string; readonly message?: string };
}

/// Error codes that would repeat for the same request, so the page stops asking.
const PERMANENT_ERRORS = new Set(["NOT_FOUND", "BAD_REQUEST"]);

/**
 * Build the transport that talks to the server's edit history through the actions.
 *
 * `inspect` calls share one request while it is in flight, whatever field they ask for.
 * An `enabled: false` in any answer calls `onDisabled`. A `NOT_FOUND` or `BAD_REQUEST`
 * stops further calls to that endpoint. Every failure rejects, which the coordinator retries.
 */
export function createActionTransport(options: {
	actions: AnswerHistoryActions;
	exam: { discipline: string; course: string; exam: string };
	onDisabled: () => void;
}): AttemptTransport {
	const { actions, exam } = options;
	const stopped = new Set<"inspect" | "send">();
	let inspection: { attemptId: string; answer: Promise<unknown> } | null = null;

	/// Run one action call and return its data, applying the shared error rules.
	async function call(
		endpoint: "inspect" | "send",
		input: Record<string, unknown>,
	): Promise<unknown> {
		if (stopped.has(endpoint))
			throw new Error(`The edit history ${endpoint} was refused for good`);
		const outcome = await actions[endpoint]({ ...exam, ...input });
		if (outcome?.error) {
			const { code, message } = outcome.error;
			if (code && PERMANENT_ERRORS.has(code)) stopped.add(endpoint);
			throw new Error(message || code || "The edit history call failed");
		}
		return outcome?.data;
	}

	/// Tell the page the server turned the history off, without letting its failure reach the coordinator.
	function notifyDisabled(): void {
		try {
			options.onDisabled();
		} catch {
			/// The page's callback is not the transport's concern.
		}
	}

	function inspectAttempt(attemptId: string): Promise<unknown> {
		if (inspection?.attemptId === attemptId) return inspection.answer;
		const answer = call("inspect", { attempt: attemptId }).finally(() => {
			if (inspection?.answer === answer) inspection = null;
		});
		inspection = { attemptId, answer };
		return answer;
	}

	return {
		async inspect(ref) {
			const parsed = answerEditInspectResult.safeParse(
				await inspectAttempt(ref.attemptId),
			);
			if (!parsed.success)
				throw new Error("Malformed answer from the edit history");
			if (!parsed.data.enabled) notifyDisabled();
			const field = parsed.data.fields.find(
				(candidate) =>
					candidate.question === ref.questionId &&
					candidate.field === ref.field,
			);
			return {
				text: field?.text ?? "",
				revision: field?.revision ?? 0,
				nextSeq: field?.nextSeq ?? 0,
				canWrite: field?.canWrite ?? true,
				receipts: field?.receipts ?? [],
			};
		},

		async send(request) {
			const parsed = answerEditAppendResult.safeParse(
				await call("send", {
					attempt: request.attemptId,
					fields: request.fields.map(({ questionId, field, batch, gaps }) => ({
						question: questionId,
						field,
						...(batch ? { batch } : {}),
						...(gaps ? { gaps } : {}),
					})),
				}),
			);
			if (!parsed.success)
				throw new Error("Malformed answer from the edit history");
			if (!parsed.data.enabled) notifyDisabled();
			return parsed.data.results.map((result): FieldResult => {
				const { question, field } = result;
				const named = { questionId: question, field };
				switch (result.kind) {
					case "accepted":
						return { ...named, kind: "accepted", receipt: result.receipt };
					case "retry":
						return { ...named, kind: "retry" };
					default:
						return { ...named, kind: result.kind, message: result.reason };
				}
			});
		},
	};
}

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
	transport: AttemptTransport;
}): Promise<AnswerEditAdapter> {
	const { ownerId, attemptId, transport } = options;
	const store = await openIndexedDbEditStore({ ownerId, indexedDB });
	const coordinator = new AnswerEditCoordinator({
		ownerId,
		attemptId,
		store,
		transport,
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

/**
 * Remove the local records of the given questions of an attempt, in the background; never rejects.
 *
 * A browser that cannot open its storage has nothing to remove.
 */
export async function removeAnswerEditRecords(options: {
	ownerId: string;
	attemptId: string;
	questionIds: readonly string[];
}): Promise<void> {
	try {
		const { ownerId, attemptId, questionIds } = options;
		const store = await openIndexedDbEditStore({ ownerId, indexedDB });
		await Promise.allSettled(
			questionIds.map((questionId) =>
				store.remove({ attemptId, questionId, field: "answer" }),
			),
		);
	} catch {
		/// The records expire on their own.
	}
}
