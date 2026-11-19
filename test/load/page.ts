/**
 * The exam page of one synthetic student, without a browser.
 *
 * It saves answers, records the edit history and follows the sends as
 * `ExamAttempt.tsx` does: the same save interval, serial save queue, retry
 * delay, saves close to the deadline and polling interval (`rhythm.ts`), and the page's own history transport,
 * coordinator and adapter, with memory in place of IndexedDB.
 */

import { createActionTransport } from "@/components/exam/answer-edit-session";
import {
	type CodeSends,
	hasPendingSend,
	sendsOf,
} from "@/components/exam/code-sends";
import { retryDelay } from "@/components/exam/save-retry";
import { AnswerEditAdapter } from "@/services/answer-edits/adapter";
import type { InputKind } from "@/services/answer-edits/codec";
import {
	AnswerEditCoordinator,
	browserCoordinatorScheduler,
} from "@/services/answer-edits/coordinator";
import type {
	EditStore,
	FieldRef,
	LocalEditRecord,
} from "@/services/answer-edits/storage";
import { isHistoryField } from "@/services/answer-history";
import type { StudentHttp } from "./http";
import type { ClientRhythm } from "./rhythm";

/// What the browser's IndexedDB store does, kept in memory for one student.
class MemoryStore implements EditStore {
	private readonly records = new Map<string, LocalEditRecord>();
	private revoked = false;
	private key(ref: FieldRef): string {
		return `${ref.attemptId}\u0000${ref.questionId}\u0000${ref.field}`;
	}
	async read(ref: FieldRef, now: number) {
		const record = this.records.get(this.key(ref));
		return this.revoked || !record || record.expiresAt <= now ? null : record;
	}
	async commit(
		ref: FieldRef,
		record: LocalEditRecord,
		expected: number | null,
	) {
		if (this.revoked) throw new Error("Transaction aborted");
		const previous = this.records.get(this.key(ref));
		if ((previous?.generation ?? null) !== expected)
			throw new Error("Stale generation");
		this.records.set(this.key(ref), record);
	}
	async remove(ref: FieldRef) {
		this.records.delete(this.key(ref));
	}
	async revoke() {
		this.revoked = true;
		this.records.clear();
	}
}

/// A send's wait for its worker, as the student saw it.
export interface GradingWait {
	question: string;
	/// Milliseconds since the start of the run.
	sentAt: number;
	/// From the send to the poll that saw it done; null while it waits.
	ms: number | null;
	state: string | null;
}

export interface ExamTarget {
	discipline: string;
	course: string;
	exam: string;
}

/// The interval of the page's clock, which `ExamAttempt.tsx` sets on mount.
const CLOCK_TICK_MS = 1000;

export class ExamPage {
	private readonly pending = new Map<string, string>();
	private readonly timers = new Map<string, NodeJS.Timeout>();
	private queue: Promise<void> = Promise.resolve();
	private failures = 0;
	private retryTimer: NodeJS.Timeout | undefined;
	private history: AnswerEditAdapter | null = null;
	private readonly sends = new Map<string, CodeSends>();
	private readonly waits = new Map<string, GradingWait>();
	private pollTimer: NodeJS.Timeout | undefined;
	private closed = false;
	private clock: NodeJS.Timeout | undefined;

	constructor(
		private readonly http: StudentHttp,
		private readonly rhythm: ClientRhythm,
		private readonly target: ExamTarget,
		private readonly attempt: string,
		private readonly startedAt: number,
		readonly gradingWaits: GradingWait[],
		/// When the exam ends, as `Date.now()`.
		deadlineAt?: number,
	) {
		if (deadlineAt === undefined) return;
		// As the page: its clock ticks every second from the moment it opened, and close to the deadline each tick saves what is pending.
		this.clock = setInterval(() => {
			if (deadlineAt - Date.now() <= this.rhythm.deadlineLeadMs)
				void this.flush();
		}, CLOCK_TICK_MS);
	}

	/// Starts the edit history as the page does when the exam's switch is on.
	startHistory(
		owner: string,
		questions: { slug: string; type: string }[],
	): void {
		const transport = createActionTransport({
			actions: {
				inspect: (input) => this.http.action("answerHistory.inspect", input),
				send: (input) => this.http.action("answerHistory.send", input),
			},
			exam: this.target,
			onDisabled: () => this.history?.disable("exam switch off"),
		});
		const scheduler = browserCoordinatorScheduler();
		const coordinator = new AnswerEditCoordinator({
			ownerId: owner,
			attemptId: this.attempt,
			store: new MemoryStore(),
			transport,
			scheduler,
			now: () => Date.now(),
			monotonicNow: () => performance.now(),
			random: () => Math.random(),
			createSessionId: () => crypto.randomUUID(),
		});
		this.history = new AnswerEditAdapter({
			coordinator,
			now: () => performance.now(),
			scheduler,
			createSessionId: () => crypto.randomUUID(),
			flushCeilingMs: this.rhythm.flushCeilingMs,
		});
		for (const question of questions) {
			if (isHistoryField(question.type, "answer"))
				this.history.attach({ questionId: question.slug, field: "answer" }, "");
		}
	}

	/// The student changed the answer of `slug`: queue its save and feed the history.
	change(slug: string, type: string, text: string, kind: InputKind): void {
		if (this.closed) return;
		this.pending.set(slug, text);
		// As the page: the save is due one interval after the first unsaved edit, and later edits do not postpone it.
		if (!this.timers.has(slug))
			this.timers.set(
				slug,
				setTimeout(() => this.saveNow(slug), this.rhythm.saveIntervalMs),
			);
		if (this.history && isHistoryField(type, "answer")) {
			try {
				this.history.input({ questionId: slug, field: "answer" }, text, kind);
			} catch {
				// The history never holds up an answer.
			}
		}
	}

	/// The student left the field of `slug`, which saves what was typed at once.
	leave(slug: string): void {
		this.saveNow(slug);
	}

	private saveNow(slug: string): void {
		const timer = this.timers.get(slug);
		if (timer) clearTimeout(timer);
		this.timers.delete(slug);
		const payload = this.pending.get(slug);
		if (payload === undefined) return;
		this.pending.delete(slug);
		this.queue = this.queue.then(async () => {
			let ok = false;
			try {
				const outcome = await withTimeout(
					this.http.action("exam.answer", {
						...this.target,
						question: slug,
						payload: payload === "" ? null : payload,
					}),
					this.rhythm.saveTimeoutMs,
				);
				ok = !outcome.error;
			} catch {
				ok = false;
			}
			if (ok) {
				this.failures = 0;
				return;
			}
			if (!this.pending.has(slug)) this.pending.set(slug, payload);
			this.failures++;
			this.scheduleRetry();
		});
	}

	private scheduleRetry(): void {
		if (this.retryTimer || this.pending.size === 0 || this.closed) return;
		this.retryTimer = setTimeout(() => {
			this.retryTimer = undefined;
			void this.flush();
		}, retryDelay(this.failures));
	}

	/// Sends everything pending; resolves to whether it all saved.
	async flush(): Promise<boolean> {
		for (const slug of [...this.pending.keys()]) this.saveNow(slug);
		await this.queue;
		return this.pending.size === 0;
	}

	/// Saves, then sends the answer of `slug` to its worker. False when refused (no sends left, closed, ...).
	async submit(slug: string, text: string): Promise<boolean> {
		if (!(await this.flush())) return false;
		const sentAt = Date.now() - this.startedAt;
		let outcome: Awaited<ReturnType<StudentHttp["action"]>>;
		try {
			outcome = await this.http.action(
				"exam.answer",
				{ ...this.target, question: slug, payload: text, kind: "SUBMIT" },
				"exam.answer:SUBMIT",
			);
		} catch {
			return false;
		}
		if (outcome.error) return false;
		const data = outcome.data as { sends?: Parameters<typeof sendsOf>[0] };
		if (data?.sends) this.updateSends(slug, sendsOf(data.sends));
		else await this.refreshSends([slug]);
		const last = this.sends.get(slug)?.submissions.at(-1);
		if (last) {
			const wait: GradingWait = {
				question: slug,
				sentAt,
				ms: null,
				state: last.jobState,
			};
			this.waits.set(last.submission, wait);
			this.gradingWaits.push(wait);
		}
		this.ensurePolling();
		return true;
	}

	/// Sends left for `slug`, as the server last told; null when unknown or unlimited.
	sendsLeft(slug: string): number | null {
		const sends = this.sends.get(slug);
		return sends?.limit == null ? null : sends.limit - sends.used;
	}

	/// Whether a send of `slug` still waits for its worker.
	waiting(slug: string): boolean {
		return hasPendingSend(this.sends.get(slug));
	}

	private updateSends(slug: string, sends: CodeSends): void {
		this.sends.set(slug, sends);
		for (const sent of sends.submissions) {
			const wait = this.waits.get(sent.submission);
			if (
				wait &&
				wait.ms === null &&
				sent.jobState !== "QUEUED" &&
				sent.jobState !== "CLAIMED"
			) {
				wait.ms = Date.now() - this.startedAt - wait.sentAt;
				wait.state = sent.jobState;
			}
		}
	}

	private async refreshSends(slugs: string[]): Promise<void> {
		try {
			const { data } = await this.http.action(
				"gradingJob.forStudentQuestions",
				{ response: this.attempt, questions: slugs },
			);
			if (!data) return;
			const views = data as Record<string, Parameters<typeof sendsOf>[0]>;
			for (const [slug, view] of Object.entries(views)) {
				this.updateSends(slug, sendsOf(view));
			}
		} catch {
			// The next poll asks again.
		}
	}

	/// Polls the sends that wait for a worker every `SENDS_POLL_MS`, as the page's effect does.
	private ensurePolling(): void {
		if (this.pollTimer || this.closed) return;
		this.pollTimer = setInterval(() => {
			const waiting = [...this.sends]
				.filter(([, s]) => hasPendingSend(s))
				.map(([slug]) => slug);
			if (waiting.length === 0 || this.closed) {
				clearInterval(this.pollTimer);
				this.pollTimer = undefined;
				return;
			}
			void this.refreshSends(waiting);
		}, this.rhythm.sendsPollMs);
	}

	/// Hands the attempt in: saves, flushes the history within its bound, finishes and reloads.
	async finish(pageUrl: string): Promise<void> {
		await this.flush();
		const flushed = withTimeout(
			Promise.resolve(this.history?.flushFinal()),
			this.rhythm.historyFinalWaitMs,
		).catch(() => {});
		try {
			await this.http.action("exam.finish", this.target);
		} catch {
			// Counted by the recorder.
		}
		await flushed;
		await withTimeout(
			Promise.resolve(this.history?.discard()),
			this.rhythm.historyFinalWaitMs,
		).catch(() => {});
		this.close();
		await this.http.page("page:exam", pageUrl);
	}

	/// The tab closes: timers stop, nothing else is sent.
	close(): void {
		this.closed = true;
		for (const timer of this.timers.values()) clearTimeout(timer);
		clearTimeout(this.retryTimer);
		clearInterval(this.pollTimer);
		clearInterval(this.clock);
		this.history?.disable("page closed");
	}
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("timeout")), ms);
		promise.then(resolve, reject).finally(() => clearTimeout(timer));
	});
}
