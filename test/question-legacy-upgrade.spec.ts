import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { NotAllowed } from "@/core/error";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { LEGACY_VERSION_SUFFIX } from "@/db/services/question.service";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedQuestionFactory } from "@/fixtures/question.factory";
import { persistedUserFactory } from "@/fixtures/user.factory";
import { LEGACY, type LegacyVersion } from "./legacy-questions";
import { resetDatabase } from "./stories/helpers";

test.beforeEach(resetDatabase);

/// Creates a question, then overwrites its stored version with `legacy`, as
/// a database written by 0.2 holds it.
async function legacyQuestion(
	courseId: number,
	slug: string,
	legacy: LegacyVersion,
) {
	const question = await persistedQuestionFactory.create({
		course: courseId as never,
		slug,
	});
	await prisma.questionData.updateMany({
		where: { refId: question.id },
		data: {
			publicPayload: legacy.publicPayload,
			privatePayload: legacy.privatePayload,
		},
	});
}

test("instructor reads of 0.2 versions fail until the upgrade, then return the whole document", async () => {
	const course = await persistedCourseFactory.create();
	await legacyQuestion(course.id, "mc", LEGACY.multipleChoice);
	await legacyQuestion(course.id, "fill", LEGACY.fillIn);
	const read = () =>
		db.question.findMany({ course: course.id, public: false }, FULL_ACCESS);
	await expect(read()).rejects.toThrow();

	const report = await db.question.upgradeLegacyVersions({}, FULL_ACCESS);

	expect(report).toEqual({ upgraded: 2, current: 0, failed: [] });
	const questions = await read();
	expect(questions.map((q) => q.question.type).sort()).toEqual([
		"fill-in",
		"multiple-choice",
	]);
	const publicRead = await db.question.findMany(
		{ course: course.id, public: true },
		FULL_ACCESS,
	);
	expect(JSON.stringify(publicRead)).not.toContain("tucano");
});

test("a second upgrade changes nothing", async () => {
	const course = await persistedCourseFactory.create();
	await legacyQuestion(course.id, "essay", LEGACY.essay);
	await db.question.upgradeLegacyVersions({}, FULL_ACCESS);

	const report = await db.question.upgradeLegacyVersions({}, FULL_ACCESS);

	expect(report).toEqual({ upgraded: 0, current: 1, failed: [] });
});

test("a dry run reports without writing", async () => {
	const course = await persistedCourseFactory.create();
	await legacyQuestion(course.id, "essay", LEGACY.essay);

	const report = await db.question.upgradeLegacyVersions(
		{ dryRun: true },
		FULL_ACCESS,
	);

	expect(report.upgraded).toBe(1);
	const again = await db.question.upgradeLegacyVersions(
		{ dryRun: true },
		FULL_ACCESS,
	);
	expect(again.upgraded).toBe(1);
});

test("a version that cannot be converted is reported by slug and the rest go through", async () => {
	const course = await persistedCourseFactory.create();
	await legacyQuestion(course.id, "ok", LEGACY.essay);
	await legacyQuestion(course.id, "broken", {
		publicPayload: { type: "essay", stem: "a" },
		privatePayload: { stem: "b" },
	});

	const report = await db.question.upgradeLegacyVersions({}, FULL_ACCESS);

	expect(report.upgraded).toBe(1);
	expect(report.failed.map((f) => f.slug)).toEqual(["broken"]);
});

test("only the system may run the upgrade", async () => {
	const instructor = await persistedUserFactory.create({ role: "INSTRUCTOR" });

	await expect(
		db.question.upgradeLegacyVersions({}, { actor: instructor }),
	).rejects.toThrow(NotAllowed);
});

test("pushing the old label again after the upgrade appends a version instead of a conflict", async () => {
	const course = await persistedCourseFactory.create();
	await legacyQuestion(course.id, "essay", LEGACY.essay);
	await db.question.upgradeLegacyVersions({}, FULL_ACCESS);
	const [upgraded] = await db.question.findMany(
		{ course: course.id, public: false },
		FULL_ACCESS,
	);
	if (!upgraded) throw new Error("expected the upgraded question");
	expect(upgraded.version).toBe(`1${LEGACY_VERSION_SUFFIX}`);

	const pushed = await db.question.update(
		{ course: course.id, slug: "essay" },
		{ version: "1", question: upgraded.question },
		FULL_ACCESS,
	);

	expect(pushed.version).toBe("1");
});
