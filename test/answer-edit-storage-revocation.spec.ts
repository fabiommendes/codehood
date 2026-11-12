import { expect, test } from "@playwright/test";
import { AnswerEditMonitor } from "@/services/answer-edits/monitor";
import type {
	EditStore,
	LocalEditRecord,
} from "@/services/answer-edits/storage";
import { bundleForBrowser, STORAGE_MODULE } from "./helpers/answer-edit-bundle";

declare global {
	interface Window {
		revocationHandles: EditStore[];
	}
}

const REF = { attemptId: "attempt", questionId: "question", field: "answer" };
const OTHER_FIELD = { ...REF, field: "other" };
const FRESH_FIELD = { ...REF, field: "new-session" };
const PREFIX = "storage-revocation";
const NOW = 1000;

function record(text: string): LocalEditRecord {
	const monitor = new AnswerEditMonitor({
		initialText: text,
		sessionId: "revocation-session",
		baseRevision: 0,
		firstSeq: 1,
		now: () => 0,
	});
	return {
		version: 1,
		generation: 1,
		savedAt: NOW,
		expiresAt: 10_000,
		text,
		checkpoint: monitor.exportCheckpoint(),
		outbox: null,
	};
}

const INITIAL = record("private draft");
let browserBundle: string;
test.beforeAll(async () => {
	browserBundle = await bundleForBrowser("answerEditStorage", [STORAGE_MODULE]);
});

test("IndexedDB revoke fences every old handle across pages without erasing a fresh session or other namespaces", async ({
	page,
	context,
}) => {
	const remotePage = await context.newPage();
	for (const target of [page, remotePage]) {
		await target.goto("/");
		await target.addScriptTag({ content: browserBundle });
		await target.evaluate(
			async ({ prefix }) => {
				const open = async (ownerId: string, namespace = prefix) =>
					window.answerEditStorage.openIndexedDbEditStore({
						ownerId,
						indexedDB,
						databasePrefix: namespace,
					});
				window.revocationHandles = [
					await open("alice"),
					await open("alice"),
					await open("bob"),
					await open("alice", `${prefix}-independent`),
				];
			},
			{ prefix: PREFIX },
		);
	}

	const args = {
		prefix: PREFIX,
		ref: REF,
		other: OTHER_FIELD,
		freshRef: FRESH_FIELD,
		initial: INITIAL,
		now: NOW,
	};
	await page.evaluate(async ({ ref, other, initial }) => {
		for (const index of [0, 2, 3]) {
			const handle = window.revocationHandles[index];
			if (!handle) throw new Error("Missing fixture handle");
			for (const field of [ref, other]) {
				await handle.commit(field, initial, null);
			}
		}
	}, args);

	/// Both pages have opened their handles before revocation completes.
	await page.evaluate(async () => {
		await window.revocationHandles[0]?.revoke();
	});
	const cleared = await page.evaluate(async (args) => {
		const fresh = await window.answerEditStorage.openIndexedDbEditStore({
			ownerId: "alice",
			indexedDB,
			databasePrefix: args.prefix,
		});
		window.revocationHandles.push(fresh);
		const cleared = await Promise.all(
			[args.ref, args.other].map((ref) => fresh.read(ref, args.now)),
		);
		await fresh.commit(args.freshRef, args.initial, null);
		return cleared;
	}, args);
	expect(cleared).toEqual([null, null]);

	for (const [label, target] of [
		["same page", page],
		["other page", remotePage],
	] as const) {
		const outcomes = await target.evaluate(
			async (args) => {
				const outcomes = [];
				for (const [index, handle] of window.revocationHandles
					.slice(0, 2)
					.entries()) {
					const callbackRef = {
						...args.ref,
						field: `${args.label}-${index}`,
					};
					/// Retained callbacks run only after logout and the fresh session.
					const callbacks: (() => unknown)[] = [
						() => handle.read(args.freshRef, args.now),
						() => handle.commit(callbackRef, args.initial, null),
					];
					const results = await Promise.allSettled(
						callbacks.map((callback) => Promise.resolve().then(callback)),
					);
					outcomes.push(results.map((result) => result.status));
				}
				return outcomes;
			},
			{ ...args, label },
		);
		expect.soft(outcomes, `${label} old read and write reject`).toEqual([
			["rejected", "rejected"],
			["rejected", "rejected"],
		]);
	}

	const resurrected = await page.evaluate(async ({ ref, now }) => {
		const fresh = window.revocationHandles[4];
		if (!fresh) throw new Error("Missing fresh handle");
		return Promise.all(
			["same page-0", "same page-1", "other page-0", "other page-1"].map(
				(field) => fresh.read({ ...ref, field }, now),
			),
		);
	}, args);
	expect
		.soft(resurrected, "old callbacks cannot resurrect cleared data")
		.toEqual([null, null, null, null]);

	for (const target of [page, remotePage]) {
		await target.evaluate(async () => {
			for (const handle of window.revocationHandles.slice(0, 2)) {
				await handle.revoke();
				await handle.revoke();
			}
		});
	}

	const remaining = await page.evaluate(async ({ ref, freshRef, now }) => {
		const [fresh, bob, independent] = [
			window.revocationHandles[4],
			window.revocationHandles[2],
			window.revocationHandles[3],
		];
		if (!fresh || !bob || !independent)
			throw new Error("Missing fixture handle");
		return {
			cleared: await fresh.read(ref, now),
			fresh: await fresh.read(freshRef, now),
			bob: await bob.read(ref, now),
			independent: await independent.read(ref, now),
		};
	}, args);
	const expected = INITIAL;
	expect
		.soft(remaining.cleared, "old callbacks cannot resurrect cleared data")
		.toBeNull();
	expect
		.soft(remaining.fresh, "old repeated revoke cannot erase a fresh session")
		.toEqual(expected);
	expect.soft(remaining.bob, "other owner is unaffected").toEqual(expected);
	expect
		.soft(remaining.independent, "other prefix is unaffected")
		.toEqual(expected);
});
