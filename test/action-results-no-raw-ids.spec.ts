import { type APIRequestContext, expect, test } from "@playwright/test";
import { persistedInviteFactory } from "@/fixtures/invite.factory";
import { parseDevalue } from "./helpers/devalue-lite";
import { findRawIdOrHashKeys } from "./helpers/raw-ids";

/**
 * `dev/specs/to-do/actions-no-raw-ids.md`: `admin.createUser` and
 * `auth.acceptInvite` are called the way a browser does — `POST
 * /_actions/<name>` as form data, the action's own `accept: "form"` — and
 * their results must never carry `passwordHash` or an id-shaped key. Both
 * actions are form actions, so the request goes in as
 * `application/x-www-form-urlencoded`; a successful result comes back
 * `devalue`-stringified (`content-type: application/json+devalue`, not plain
 * JSON — see `test/helpers/devalue-lite.ts`).
 */

const PASSWORD = "correct-horse-battery-staple";

function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

async function adminHeaders(request: APIRequestContext) {
	const login = await request.post("/api/auth/login", {
		data: { login: "admin", password: "admin" },
	});
	expect(login.ok()).toBe(true);
	const { token } = await login.json();
	return { Authorization: `Bearer ${token}` };
}

/// Posts a form-accepting action the way a browser form submit does, and
/// hands back the revived body of a successful result.
async function callFormAction(
	request: APIRequestContext,
	name: string,
	form: Record<string, string>,
	headers: Record<string, string> = {},
): Promise<unknown> {
	const res = await request.post(`/_actions/${name}`, { headers, form });
	expect(res.status(), await res.text()).toBe(200);
	return parseDevalue(await res.text());
}

test("admin.createUser's result carries no passwordHash and no id-shaped key", async ({
	request,
}) => {
	const headers = await adminHeaders(request);
	const username = tag("newuser");

	const result = await callFormAction(
		request,
		"admin.createUser",
		{
			name: "New User",
			email: `${username}@codehood.test`,
			username,
			role: "INSTRUCTOR",
			password: PASSWORD,
			githubId: username,
			schoolId: username,
		},
		headers,
	);

	expect(result).not.toHaveProperty("passwordHash");
	expect(findRawIdOrHashKeys(result), JSON.stringify(result)).toEqual([]);
});

test("auth.acceptInvite's result carries no passwordHash and no id-shaped key", async ({
	request,
}) => {
	const username = tag("invitee");
	const email = `${username}@codehood.test`;
	const invite = await persistedInviteFactory.create({
		kind: "PERSONAL",
		invitedRole: "STUDENT",
		email,
		maxUses: 1,
	});
	// biome-ignore lint/style/noNonNullAssertion: create() always sets a token
	const token = invite.token!;

	const result = await callFormAction(request, "auth.acceptInvite", {
		token,
		email,
		username,
		name: "New Invitee",
		password: PASSWORD,
		githubId: username,
		schoolId: username,
	});

	expect(result).not.toHaveProperty("passwordHash");
	expect(findRawIdOrHashKeys(result), JSON.stringify(result)).toEqual([]);
});
