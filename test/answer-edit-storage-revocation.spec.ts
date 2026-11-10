import path from "node:path";
import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { AnswerEditMonitor } from "@/services/answer-edits/monitor";
import type {
	EditStore,
	LocalEditRecord,
	TextRecovery,
	TextRecoveryStore,
} from "@/services/answer-edits/storage";

declare global {
	interface Window {
		revocationHandles: (EditStore | TextRecoveryStore)[];
		revocationFixtureReady: Promise<void>;
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
const FALLBACK: TextRecovery = {
	version: 1,
	savedAt: NOW,
	expiresAt: 10_000,
	text: "private draft",
	historyGap: true,
};

let browserBundle: string;
test.beforeAll(async () => {
	const bundle = await build({
		stdin: {
			contents: 'export * from "@/services/answer-edits/storage";',
			resolveDir: path.resolve("src"),
		},
		alias: { "@": path.resolve("src") },
		bundle: true,
		write: false,
		platform: "browser",
		format: "iife",
		globalName: "answerEditStorage",
		logLevel: "silent",
	});
	browserBundle = bundle.outputFiles[0]?.text ?? "";
});

for (const backend of ["IndexedDB", "localStorage"] as const) {
	test(`${backend} revoke fences every old handle across pages without erasing a fresh session or other namespaces`, async ({
		page,
		context,
	}) => {
		const remotePage = await context.newPage();
		for (const target of [page, remotePage]) {
			await target.goto("/");
			await target.addScriptTag({ content: browserBundle });
			await target.evaluate(
				async ({ backend, prefix }) => {
					const open = async (ownerId: string, namespace = prefix) =>
						backend === "IndexedDB"
							? window.answerEditStorage.openIndexedDbEditStore({
									ownerId,
									indexedDB,
									databasePrefix: namespace,
								})
							: window.answerEditStorage.createTextRecoveryStore({
									ownerId,
									storage: localStorage,
									keyPrefix: namespace,
								});
					window.revocationHandles = [
						await open("alice"),
						await open("alice"),
						await open("bob"),
						await open("alice", `${prefix}-independent`),
					];
				},
				{ backend, prefix: PREFIX },
			);
		}

		if (backend === "localStorage") {
			await remotePage.evaluate(() => {
				window.revocationFixtureReady = new Promise<void>((resolve) => {
					const observe = (event: StorageEvent) => {
						if (event.key !== "revocation-fixture-ready") return;
						removeEventListener("storage", observe);
						resolve();
					};
					addEventListener("storage", observe);
				});
			});
		}
		const args = {
			backend,
			prefix: PREFIX,
			ref: REF,
			other: OTHER_FIELD,
			freshRef: FRESH_FIELD,
			initial: INITIAL,
			fallback: FALLBACK,
			now: NOW,
		};
		await page.evaluate(async ({ backend, ref, other, initial, fallback }) => {
			for (const index of [0, 2, 3]) {
				const handle = window.revocationHandles[index];
				if (!handle) throw new Error("Missing fixture handle");
				for (const field of [ref, other]) {
					if (backend === "IndexedDB")
						await (handle as EditStore).commit(field, initial, null);
					else (handle as TextRecoveryStore).write(field, fallback);
				}
			}
		}, args);

		/// Synchronize seeded fixture data before logout, not the revocation itself.
		/// Chromium may still be populating the other page's initial storage cache.
		if (backend === "localStorage") {
			await page.evaluate(() =>
				localStorage.setItem("revocation-fixture-ready", "ready"),
			);
			await remotePage.evaluate(() => window.revocationFixtureReady);
		}
		/// Both pages have opened their handles before revocation completes.
		await page.evaluate(async () => {
			await window.revocationHandles[0]?.revoke();
		});
		const cleared = await page.evaluate(async (args) => {
			const fresh =
				args.backend === "IndexedDB"
					? await window.answerEditStorage.openIndexedDbEditStore({
							ownerId: "alice",
							indexedDB,
							databasePrefix: args.prefix,
						})
					: window.answerEditStorage.createTextRecoveryStore({
							ownerId: "alice",
							storage: localStorage,
							keyPrefix: args.prefix,
						});
			window.revocationHandles.push(fresh);
			const cleared = await Promise.all(
				[args.ref, args.other].map((ref) => fresh.read(ref, args.now)),
			);
			if (args.backend === "IndexedDB")
				await (fresh as EditStore).commit(args.freshRef, args.initial, null);
			else (fresh as TextRecoveryStore).write(args.freshRef, args.fallback);
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
							() =>
								args.backend === "IndexedDB"
									? (handle as EditStore).commit(
											callbackRef,
											args.initial,
											null,
										)
									: (handle as TextRecoveryStore).write(
											callbackRef,
											args.fallback,
										),
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
		const expected = backend === "IndexedDB" ? INITIAL : FALLBACK;
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
}
