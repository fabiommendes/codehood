import { FULL_ACCESS } from "@/auth/actor";
import { db, type User } from "@/db";

/// A 1×1 PNG, small enough to inline and real enough for the browser to draw.
export const TINY_PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
	"base64",
);

/// Sends a report as `author`, the way the dialog would, for stories that start after it was sent.
export function sendReport(
	author: Pick<User, "username" | "name" | "role">,
	input: Parameters<typeof db.report.create>[0],
) {
	return db.report.create(input, {
		actor: { username: author.username, name: author.name, role: author.role },
	});
}

/// The reports `author` sent, as SYSTEM sees them.
export function reportsOf(author: Pick<User, "username">) {
	return db.report.findMany({ author: author.username }, FULL_ACCESS);
}
