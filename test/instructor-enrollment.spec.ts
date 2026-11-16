/**
 * A course's instructor cannot be enrolled in it as a student, and
 * `instructorEnrollments` finds the ones that already exist.
 */
import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { InvalidData } from "@/core/error";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { assertNotInstructor } from "@/db/enrollment-guard";
import { persistedResponseFactory } from "@/fixtures/response.factory";
import { enroll, makeWorld } from "./answer-edit-service-support";

/// Enrolls the instructor of `world` behind the service's back.
function forceEnroll(world: Awaited<ReturnType<typeof makeWorld>>) {
	return prisma.enrollment.create({
		data: { username: world.instructor.username, courseId: world.course.id },
	});
}

test("enrollment.create refuses the instructor of the course on `username`", async () => {
	const world = await makeWorld();
	const error = await db.enrollment
		.create(
			{ course: world.course.id, username: world.instructor.username },
			FULL_ACCESS,
		)
		.catch((e) => e);

	expect(error).toBeInstanceOf(InvalidData);
	expect(Object.keys((error as InvalidData).errors)).toEqual(["username"]);
	expect(
		await prisma.enrollment.count({
			where: { username: world.instructor.username, courseId: world.course.id },
		}),
	).toBe(0);
});

test("enrollment.create still enrolls a student, and an instructor of another course", async () => {
	const world = await makeWorld();
	const other = await makeWorld();
	await enroll(world.course.id);
	await db.enrollment.create(
		{ course: world.course.id, username: other.instructor.username },
		FULL_ACCESS,
	);
});

test("the guard used by the passphrase and check-in paths refuses the instructor only", async () => {
	const world = await makeWorld();
	await prisma.$transaction(async (tx) => {
		await expect(
			assertNotInstructor(tx, world.course.id, world.instructor.username),
		).rejects.toBeInstanceOf(InvalidData);
		await assertNotInstructor(tx, world.course.id, world.student.username);
	});
});

test("instructorEnrollments lists the instructor's enrollment with the attempt count", async () => {
	const world = await makeWorld();
	await forceEnroll(world);
	await persistedResponseFactory.create({
		course: world.course.id,
		exam: world.exam.slug,
		author: world.instructor.username,
	});

	const all = await db.enrollment.instructorEnrollments({}, FULL_ACCESS);
	const mine = all.filter((e) => e.username === world.instructor.username);

	expect(mine).toEqual([
		{
			course: expect.stringContaining(world.instructor.username),
			username: world.instructor.username,
			attempts: 1,
			removed: false,
		},
	]);
});

test("instructorEnrollments with fix removes only the enrollments without attempts", async () => {
	const withoutAttempt = await makeWorld();
	const withAttempt = await makeWorld();
	await forceEnroll(withoutAttempt);
	await forceEnroll(withAttempt);
	await persistedResponseFactory.create({
		course: withAttempt.course.id,
		exam: withAttempt.exam.slug,
		author: withAttempt.instructor.username,
	});

	const found = await db.enrollment.instructorEnrollments(
		{ fix: true },
		FULL_ACCESS,
	);

	const removed = found.find(
		(e) => e.username === withoutAttempt.instructor.username,
	);
	const kept = found.find(
		(e) => e.username === withAttempt.instructor.username,
	);
	expect(removed).toMatchObject({ attempts: 0, removed: true });
	expect(kept).toMatchObject({ attempts: 1, removed: false });
	const rows = (world: typeof withAttempt) =>
		prisma.enrollment.count({
			where: { username: world.instructor.username, courseId: world.course.id },
		});
	expect(await rows(withoutAttempt)).toBe(0);
	expect(await rows(withAttempt)).toBe(1);
});

test("instructorEnrollments is for the system only", async () => {
	const world = await makeWorld();
	await expect(
		db.enrollment.instructorEnrollments({}, { actor: world.instructor }),
	).rejects.toThrow();
});
