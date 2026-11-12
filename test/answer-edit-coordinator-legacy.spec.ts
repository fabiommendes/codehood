import { expect, test } from "@playwright/test";
import {
	drain,
	EPOCH,
	FIELD,
	REF,
	rig,
} from "./helpers/answer-edit-coordinator";

/// A record as version 2 of the checkpoint wrote it: no base mark anywhere.
async function seedLegacyRecord(h: ReturnType<typeof rig>, text: string) {
	h.append(text);
	const batch = h.monitor.collect();
	if (!batch) throw new Error("Expected fixture batch");
	const exported = JSON.parse(JSON.stringify(h.monitor.exportCheckpoint()));
	delete exported.state.baseReason;
	delete exported.state.inFlight.base;
	await h.store.commit(
		REF,
		{
			version: 1,
			generation: 1,
			savedAt: EPOCH,
			expiresAt: EPOCH + 60_000,
			text,
			checkpoint: { ...exported, version: 2 },
			outbox: null,
		},
		null,
	);
}

test.describe("answer edit coordinator: checkpoints of the previous version", () => {
	test("recover refuses the old checkpoint, records a gap and keeps the field writable", async () => {
		const h = rig();
		await seedLegacyRecord(h, "typed before the upgrade");
		const recovered = await h.coordinator.recover(FIELD, "server text");
		await drain();
		const status = h.coordinator.getStatus(FIELD);
		expect(status?.historyGap).toBe(true);
		expect(status?.savedText).toBe("typed before the upgrade");
		expect(recovered.handle.getState().text).toBe("server text");
		/// The next save replaces the old record with one of the current version.
		await h.coordinator.persist();
		const stored = await h.store.read(REF, EPOCH);
		expect(stored?.checkpoint.version).toBe(3);
		expect(stored?.generation).toBe(2);
		await h.coordinator.dispose();
	});

	test("an old checkpoint handed to register is a gap and never throws", async () => {
		const h = rig();
		await seedLegacyRecord(h, "typed before the upgrade");
		await h.coordinator.register(FIELD, h.monitor);
		await drain();
		expect(h.coordinator.getStatus(FIELD)?.historyGap).toBe(true);
		await h.coordinator.dispose();
	});
});
