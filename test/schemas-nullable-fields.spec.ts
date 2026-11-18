import { expect, test } from "@playwright/test";
import { inviteUpdate } from "@/core/schemas/invite";
import { reportUpdate } from "@/core/schemas/report";

test("inviteUpdate: maxUses is nullable, so a client can clear the limit", () => {
	expect(inviteUpdate.safeParse({ maxUses: null }).success).toBe(true);
	expect(inviteUpdate.safeParse({}).success).toBe(true);
	expect(inviteUpdate.safeParse({ maxUses: 0 }).success).toBe(false);
});

test("reportUpdate: status and kind cannot be null (the columns are not nullable), note can", () => {
	expect(reportUpdate.safeParse({ status: null }).success).toBe(false);
	expect(reportUpdate.safeParse({ kind: null }).success).toBe(false);
	expect(reportUpdate.safeParse({ note: null }).success).toBe(true);
	expect(reportUpdate.safeParse({}).success).toBe(true);
});
