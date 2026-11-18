// The lifecycle of a question's status, in one place. Pure, so the browser
// imports it too: no Prisma, no node modules.
import type { z } from "zod";
import type { questionStatus } from "@/core/schemas/question";

export type QuestionStatus = z.infer<typeof questionStatus>;

/// What an actor gets from a question: the whole document, nothing as if it were missing, or a refusal.
export type QuestionVisibility = "full" | "absent" | "refused";

/**
 * What the web status button moves a question to next.
 *
 * A published question is withdrawn as `HIDDEN`, not moved back to `DRAFT`:
 * a push never undoes `HIDDEN`, while it republishes a draft whose file has
 * no `_` prefix. Archiving is deleting, which a push also reverts while the
 * file exists, so the button never offers it.
 */
export const webNext: Record<QuestionStatus, QuestionStatus> = {
	ARCHIVED: "DRAFT",
	DRAFT: "PUBLISHED",
	PUBLISHED: "HIDDEN",
	HIDDEN: "PUBLISHED",
};

/**
 * What an actor related to the question in this way gets from it.
 *
 * An author gets the whole document. Someone outside the course is refused
 * whatever the status, so a refusal never tells a hidden slug from a published
 * one. A course member who is not an author finds the question missing: a
 * student reads an exam question only through the grant of the exam.
 */
export function visibility(
	_status: QuestionStatus,
	rel: { author: boolean; member: boolean },
): QuestionVisibility {
	if (rel.author) return "full";
	return rel.member ? "absent" : "refused";
}

/// Whether a question in this status takes writes: an archived one comes back only through `create` or `upsert`.
export function writable(status: QuestionStatus): boolean {
	return status !== "ARCHIVED";
}
