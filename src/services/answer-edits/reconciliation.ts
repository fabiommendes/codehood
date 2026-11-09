import { type CheckpointState, parseCheckpoint } from "./checkpoint";
import type { ServerFieldState } from "./coordinator";
import type { BatchReceipt, MonitorCheckpoint } from "./monitor";

interface Reconciliation {
	readonly state: CheckpointState;
	readonly receipt: BatchReceipt | null;
	readonly reason: string | null;
}

/// Check the confirmed baseline, allowing only a precisely identified lost acknowledgement.
export function reconcileCheckpoint(
	checkpoint: MonitorCheckpoint,
	server: ServerFieldState,
): Reconciliation {
	const state = parseCheckpoint(checkpoint);
	const batch = state.inFlight;
	const receipt = batch
		? (server.receipts.find((item) => item.batchId === batch.batchId) ?? null)
		: null;
	if (receipt) {
		if (
			!batch ||
			receipt.revision !== batch.baseRevision + 1 ||
			receipt.lastSeq !== batch.firstSeq + batch.edits.length - 1 ||
			server.revision !== receipt.revision ||
			server.nextSeq !== receipt.lastSeq + 1 ||
			server.text !== batch.snapshot
		) {
			return {
				state,
				receipt: null,
				reason: "Server receipt or baseline diverged",
			};
		}
		return { state, receipt, reason: null };
	}
	const compatible =
		state.baseRevision === server.revision &&
		state.firstSeq === server.nextSeq &&
		state.confirmedText === server.text;
	return {
		state,
		receipt: null,
		reason: compatible ? null : "Server baseline diverged",
	};
}

/// Compare pending evidence without requiring identical session bookkeeping after restore.
export function equivalentCheckpoints(
	left: MonitorCheckpoint,
	right: MonitorCheckpoint,
): boolean {
	const evidence = (checkpoint: MonitorCheckpoint): unknown => {
		const state = parseCheckpoint(checkpoint);
		return {
			text: state.text,
			confirmedText: state.confirmedText,
			baseRevision: state.baseRevision,
			firstSeq: state.firstSeq,
			inFlight: state.inFlight,
			edits: [
				...state.queue.flatMap((segment) => segment.edits),
				...state.active.edits,
				...(state.active.openEdit ? [state.active.openEdit.edit] : []),
			],
		};
	};
	return JSON.stringify(evidence(left)) === JSON.stringify(evidence(right));
}
