import { makeWorld } from "./answer-edit-service-support";
import { expect, test } from "./fixtures";
import { resetDatabase } from "./stories/helpers";

/// An action wrapped by `withServiceErrors` must not turn the `UNAUTHORIZED` of
/// `requireUser` into a `BAD_REQUEST`.

test.beforeEach(resetDatabase);

test("exam.answer without a session answers 401 UNAUTHORIZED", async ({
	page,
}) => {
	const world = await makeWorld();
	const response = await page.request.post("/_actions/exam.answer", {
		data: {
			discipline: world.course.discipline.slug,
			course: `${world.course.instructor.username}_${world.course.edition.slug}`,
			exam: world.exam.slug,
			question: world.slugs.text,
			payload: "an answer",
		},
	});
	const text = await response.text();
	expect(response.status(), text).toBe(401);
	expect(JSON.parse(text).code).toBe("UNAUTHORIZED");
});
