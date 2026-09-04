import type { AstroGlobal } from "astro";
import { canManageEnrollment } from "@/auth/permissions";
import { NotAllowed } from "@/core/error";
import { type Course, courseService } from "@/db/services/course.service";
import { courseHref, parseCourseSegment } from "./course-url";

export type LoadCourseResult =
	| { course: Course; href: string }
	| { redirect: Response };

/**
 * The four steps every course page needs: parse the URL segment, load the
 * course, check the actor may see it, and 403/404 on failure. `Astro.rewrite`
 * keeps the browser URL (unlike `Astro.redirect`), which is what lets the 403
 * page name the course the visitor was trying to reach. Also hands back the
 * course's `href`, so the same five-line `courseHref(...)` call isn't
 * repeated on every page.
 *
 * Pass `manage: true` on instructor-only pages (`/manage`, `/roster`) to
 * also require {@link canManageEnrollment}, not just visibility — the same
 * predicate `courseTabs` uses to decide whether those tabs even show up (see
 * `dev/specs/to-do/course-navigation.md`).
 */
export async function loadCourse(
	Astro: AstroGlobal,
	disciplineSlug: string | undefined,
	courseSegment: string | undefined,
	opts?: { manage?: boolean },
): Promise<LoadCourseResult> {
	const actor = Astro.locals.actor;
	if (!actor) {
		return { redirect: Astro.redirect("/login") };
	}

	const parsed = courseSegment ? parseCourseSegment(courseSegment) : null;
	if (!disciplineSlug || !courseSegment || !parsed) {
		return { redirect: await Astro.rewrite("/404") };
	}
	const segment = courseSegment;

	let course: Course | null;
	try {
		course = await courseService.findOne(
			{
				ref: {
					disciplineSlug,
					username: parsed.username,
					edition: parsed.edition,
				},
			},
			{ actor },
		);
	} catch (error) {
		if (error instanceof NotAllowed) {
			return { redirect: await forbidden(Astro, segment) };
		}
		throw error;
	}

	if (!course) {
		return { redirect: await Astro.rewrite("/404") };
	}
	if (opts?.manage && !canManageEnrollment(actor, course)) {
		return { redirect: await forbidden(Astro, segment) };
	}

	return {
		course,
		href: courseHref({
			disciplineSlug: course.disciplineSlug,
			username: course.instructor.username,
			edition: course.editionSlug,
		}),
	};
}

function forbidden(Astro: AstroGlobal, courseName: string): Promise<Response> {
	const url = new URL("/403", Astro.url);
	url.searchParams.set("course", courseName);
	return Astro.rewrite(url);
}
