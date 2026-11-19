import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { codeAt } from "@/services/roll-call-code";
import { courseHref } from "@/urls";

/// What no page links to: a URL that carries a token, or one a person types.
const DAY_MS = 24 * 60 * 60 * 1000;

async function inviteUrl(expiresInMs?: number): Promise<string> {
	const course = await prisma.course.findFirstOrThrow({
		where: { instructorId: "ada" },
		orderBy: { endDate: "desc" },
	});
	const { token } = await db.invite.create(
		{
			kind: "CLASSROOM",
			invitedRole: "STUDENT",
			email: null,
			course: course.id,
			maxUses: null,
			createdBy: { username: "ada", name: "Ada" },
			...(expiresInMs === undefined ? {} : { expiresInMs }),
		},
		FULL_ACCESS,
	);
	return `/invite/${token}`;
}

/// The check-in link of the roll call that closes last, with the code it
/// shows now, or a wrong one.
async function rollCallUrl(valid: boolean): Promise<string> {
	const rollCall = await prisma.rollCall.findFirstOrThrow({
		orderBy: { closesAt: "desc" },
	});
	const code = valid ? codeAt(rollCall.secret, new Date()).code : "WRONG1";
	return `/c/${rollCall.id}/${code}`;
}

async function hrefOf(where: object): Promise<string> {
	const course = await prisma.course.findFirstOrThrow({
		where,
		orderBy: { endDate: "desc" },
	});
	return courseHref({
		discipline: course.disciplineSlug,
		instructor: course.instructorId,
		edition: course.editionSlug,
	});
}

/**
 * Start URLs of `role` that must be minted in the database of the server
 * under test: invite tokens, check-in codes, and pages no link leads to.
 */
export async function dynamicStarts(role: string): Promise<string[]> {
	switch (role) {
		case "visitor":
			return [
				await inviteUrl(),
				await inviteUrl(-7 * DAY_MS),
				await rollCallUrl(false),
				await rollCallUrl(true),
			];
		case "student":
			return [
				"/check-in",
				await rollCallUrl(true),
				// A course the student is not in answers with 403.
				await hrefOf({ enrollments: { none: { username: "student" } } }),
			];
		case "instructor":
			return [`${await hrefOf({ instructorId: "ada" })}/manage`];
		default:
			return [];
	}
}
