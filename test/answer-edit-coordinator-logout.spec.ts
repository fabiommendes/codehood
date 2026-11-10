import { expect, test } from "@playwright/test";
import type { ServerFieldState } from "@/services/answer-edits/coordinator";
import {
	deferred,
	drain,
	EPOCH,
	FIELD,
	REF,
	rig,
} from "./helpers/answer-edit-coordinator";

for (const cleanupFails of [false, true]) {
	test(`an inspection returned after ${cleanupFails ? "failed cleanup at" : "successful"} logout cannot restore an editor or saved status`, async () => {
		const h = rig();
		h.fallback.write(REF, {
			version: 1,
			text: "private fallback",
			historyGap: true,
			savedAt: EPOCH,
			expiresAt: EPOCH + 60_000,
		});
		const inspection = deferred<ServerFieldState>();
		const entered = deferred<void>();
		h.transport.inspect = async () => {
			entered.resolve();
			return inspection.promise;
		};
		const cleanupError = new DOMException("Cleanup denied", "SecurityError");
		if (cleanupFails)
			h.fallback.revoke = () => {
				throw cleanupError;
			};
		const recovery = h.coordinator.recover(FIELD).then(
			(value) => ({ value, error: null }),
			(error: unknown) => ({ value: null, error }),
		);
		await entered.promise;
		const logout = h.coordinator.logout();
		if (cleanupFails) await expect(logout).rejects.toBe(cleanupError);
		else await logout;
		const statuses = structuredClone(h.statuses);
		const commits = h.store.commits.length;
		inspection.resolve(h.transport.server);
		const outcome = await recovery;
		await drain();
		expect.soft(outcome.value?.kind).not.toBe("ready");
		expect.soft(outcome.value?.kind).not.toBe("text-only");
		expect.soft(outcome.value && "handle" in outcome.value).toBeFalsy();
		expect.soft(h.statuses).toEqual(statuses);
		await h.coordinator.persist();
		await h.coordinator.flushDelivery();
		await h.scheduler.advance(120_000);
		expect.soft(h.store.revoked).toBe(true);
		expect.soft(h.store.commits).toHaveLength(commits);
		expect.soft(h.transport.requests).toHaveLength(0);
		expect.soft(h.scheduler.pendingCount).toBe(0);
		await h.coordinator.dispose();
	});
}
