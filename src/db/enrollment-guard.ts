import { InvalidData } from "@/core/error";
import type { CourseId } from "@/core/schemas/base";
import { m } from "@/i18n";
import type { PrismaTx } from "./client";

/**
 * Refuses to enroll `username` in a course they teach.
 *
 * @throws {@link InvalidData} On `username` when the user is the course's instructor.
 */
export async function assertNotInstructor(
	tx: PrismaTx,
	courseId: CourseId,
	username: string,
): Promise<void> {
	const course = await tx.course.findUnique({
		where: { id: courseId },
		select: { instructorId: true },
	});
	if (course?.instructorId !== username) return;
	throw new InvalidData({
		username: [
			{
				code: "invalid",
				message: m.errors_instructor_cannot_enroll({ username }),
			},
		],
	});
}
