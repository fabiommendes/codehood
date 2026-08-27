import type { AstroGlobal } from "astro";
import { canManageCourse } from "@/auth/permissions";
import { ForbiddenError } from "@/db/base-service";
import { type CourseWithDetails, courseService } from "@/db/course.service";
import { parseCourseSegment } from "./course-url";

export type LoadCourseResult =
	| { course: CourseWithDetails }
	| { redirect: Response };

/**
 * The four steps every course page needs: parse the URL segment, load the
 * course, check the actor may see it, and 403/404 on failure. `Astro.rewrite`
 * keeps the browser URL (unlike `Astro.redirect`), which is what lets the 403
 * page name the course the visitor was trying to reach.
 *
 * Pass `manage: true` on instructor-only pages (`/manage`, `/roster`,
 * `/invite`) to also require {@link canManageCourse}, not just visibility.
 */
export async function loadCourse(
	Astro: AstroGlobal,
	disciplineSlug: string | undefined,
	courseSegment: string | undefined,
	opts?: { manage?: boolean },
): Promise<LoadCourseResult> {
	const actor = Astro.locals.user;
	if (!actor) {
		return { redirect: Astro.redirect("/login") };
	}

	const parsed = courseSegment ? parseCourseSegment(courseSegment) : null;
	if (!disciplineSlug || !courseSegment || !parsed) {
		return { redirect: await Astro.rewrite("/404") };
	}
	const segment = courseSegment;

	let course: CourseWithDetails | null;
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
		if (error instanceof ForbiddenError) {
			return { redirect: await forbidden(Astro, segment) };
		}
		throw error;
	}

	if (!course) {
		return { redirect: await Astro.rewrite("/404") };
	}
	if (opts?.manage && !canManageCourse(actor, course)) {
		return { redirect: await forbidden(Astro, segment) };
	}

	return { course };
}

function forbidden(Astro: AstroGlobal, courseName: string): Promise<Response> {
	const url = new URL("/403", Astro.url);
	url.searchParams.set("course", courseName);
	return Astro.rewrite(url);
}
