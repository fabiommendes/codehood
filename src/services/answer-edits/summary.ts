/**
 * What the instructor reads about how one answer was typed, computed from the
 * stored batches without replaying them.
 */
import type { AnswerEditSummary } from "@/core/schemas/answer-edit";
import { decodeEdits, type EditTuple, type InputKind } from "./codec";

export type { AnswerEditSummary };

/// The longest gap between two edits of a session that still counts as typing.
export const ACTIVE_IDLE_MS = 60_000;

/// Insertions of at least this many UTF-16 units are listed.
export const LARGE_INSERTION_UNITS = 100;

/// Most large insertions a summary lists.
export const MAX_LARGE_INSERTIONS = 20;

/// The columns of a stored `AnswerEditBatch` the summary reads.
export interface SummaryBatch {
	sessionId: string;
	timeOriginMs: number;
	edits: readonly EditTuple[];
	receivedAt: Date;
	baseReason: "start" | "rebase" | null;
	baseText: string | null;
	gapBefore: string | null;
}

/// A stored `AnswerEditGap` marker.
export interface SummaryMarker {
	reason: string;
	receivedAt: Date;
}

type Gap = AnswerEditSummary["gaps"][number];

/**
 * Summarizes the edit history of one answer: active time, arrival times, edits per kind, pastes, large insertions, gaps and completeness.
 *
 * Only the tuples are read, never replayed, so the result does not depend on
 * the text. Every wall-clock time is the arrival time of a batch or marker;
 * the session clock of the edits is used only for durations.
 *
 * @params batches The batches of the field, in revision order.
 * @params anchorText The field's anchor text, or `null` when it has no anchor.
 * @params answerText The text of the last submission, or `null` when unanswered.
 * @params incomplete Whether a limit stopped the field or the whole attempt.
 */
export function summarizeAnswerEdits(args: {
	batches: readonly SummaryBatch[];
	markers: readonly SummaryMarker[];
	anchorText: string | null;
	answerText: string | null;
	incomplete: boolean;
}): AnswerEditSummary {
	const { batches, markers, anchorText, answerText, incomplete } = args;
	const kinds: AnswerEditSummary["kinds"] = {
		typing: 0,
		paste: 0,
		delete: 0,
		undo: 0,
		redo: 0,
		composition: 0,
		other: 0,
	};
	const pastes = { count: 0, chars: 0 };
	const largeInsertions: AnswerEditSummary["largeInsertions"] = [];
	const sessions = new Map<string, { start: number; duration: number }[]>();
	const gaps: Exclude<Gap, { type: "final" }>[] = markers.map((marker) => ({
		type: "marker",
		reason: marker.reason,
		receivedAt: marker.receivedAt,
	}));

	for (const batch of batches) {
		const edits = decodeEdits({
			version: 1,
			timeOriginMs: batch.timeOriginMs,
			edits: batch.edits,
		});
		let session = sessions.get(batch.sessionId);
		if (!session) {
			session = [];
			sessions.set(batch.sessionId, session);
		}
		for (const edit of edits) {
			session.push({ start: edit.startMs, duration: edit.durationMs });
			kinds[edit.kind as InputKind]++;
			const inserted = edit.insertedText.length;
			if (edit.kind === "paste") {
				pastes.count++;
				pastes.chars += inserted;
			}
			if (
				inserted >= LARGE_INSERTION_UNITS &&
				largeInsertions.length < MAX_LARGE_INSERTIONS
			) {
				largeInsertions.push({
					kind: edit.kind,
					length: inserted,
					receivedAt: batch.receivedAt,
				});
			}
		}
		if (batch.baseReason === "rebase" && batch.gapBefore !== null) {
			gaps.push({
				type: "rebase",
				...changeBetween(batch.gapBefore, batch.baseText ?? ""),
				receivedAt: batch.receivedAt,
			});
		}
	}

	// Markers and rebases read in the order they arrived; the sort is stable.
	gaps.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
	const allGaps: Gap[] = [...gaps];
	if (anchorText !== null && answerText !== null && anchorText !== answerText) {
		allGaps.push({ type: "final", ...changeBetween(anchorText, answerText) });
	}

	let activeMs = 0;
	for (const edits of sessions.values()) {
		for (let i = 0; i < edits.length; i++) {
			const next = edits[i + 1];
			const edit = edits[i] as { start: number; duration: number };
			activeMs += next
				? Math.min(Math.max(next.start - edit.start, 0), ACTIVE_IDLE_MS)
				: edit.duration;
		}
	}

	return {
		state: incomplete ? "incomplete" : batches.length > 0 ? "complete" : "none",
		activeMs,
		firstAt: batches[0]?.receivedAt ?? null,
		lastAt: batches.at(-1)?.receivedAt ?? null,
		kinds,
		pastes,
		largeInsertions,
		gaps: allGaps,
	};
}

/// Units removed from `before` and inserted to make `after`, found by their common prefix and suffix, which never overlap.
function changeBetween(
	before: string,
	after: string,
): { removed: number; inserted: number } {
	const shortest = Math.min(before.length, after.length);
	let prefix = 0;
	while (prefix < shortest && before[prefix] === after[prefix]) prefix++;
	let suffix = 0;
	while (
		suffix < shortest - prefix &&
		before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
	) {
		suffix++;
	}
	return {
		removed: before.length - prefix - suffix,
		inserted: after.length - prefix - suffix,
	};
}
