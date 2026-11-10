import { expect, test } from "@playwright/test";
import { EPOCH, FIELD, REF, rig } from "./helpers/answer-edit-coordinator";

test("principal read failure without a fallback record is unavailable, never a fabricated blank monitor", async () => {
	const h = rig();
	h.store.failRead = true;
	try {
		const result = await h.coordinator.recover(FIELD);
		expect.soft(result).toMatchObject({
			kind: "unavailable",
			server: h.transport.server,
		});
		expect.soft("handle" in result).toBe(false);
		expect.soft(h.coordinator.getStatus(FIELD)).toMatchObject({
			durability: "unavailable",
			savedText: null,
		});
		await h.coordinator.flushDelivery();
		expect(h.transport.requests).toHaveLength(0);
		expect(h.store.commits).toHaveLength(0);
	} finally {
		await h.coordinator.dispose();
	}
});

test("principal read failure with an actual empty fallback preserves text-only recovery and its history gap", async () => {
	const h = rig();
	h.store.failRead = true;
	h.fallback.write(REF, {
		version: 1,
		savedAt: EPOCH,
		expiresAt: EPOCH + 60_000,
		text: "",
		historyGap: true,
	});
	try {
		const result = await h.coordinator.recover(FIELD);
		expect(result).toMatchObject({
			kind: "text-only",
			localText: "",
			historyGap: true,
			server: h.transport.server,
		});
		expect("handle" in result).toBe(false);
		expect(h.coordinator.getStatus(FIELD)).toMatchObject({
			durability: "text-only",
			savedText: "",
			historyGap: true,
		});
		await h.coordinator.flushDelivery();
		expect(h.transport.requests).toHaveLength(0);
		expect(h.store.commits).toHaveLength(0);
	} finally {
		await h.coordinator.dispose();
	}
});
