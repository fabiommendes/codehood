import type { AstroGlobal } from "astro";
import { hasPerm } from "@/auth/permissions";
import { NotAllowed } from "@/core/error";
import { type Course, db } from "@/db";
import { courseHref, parseCourseSegment } from "../urls";

export type LoadCourseResult =
	| { course: Course; href: string }
	| { redirect: Response };

// TODO: IMPORTANT! database access must be done through service classes.
/**
 * The four steps every course page needs: parse the URL segment, load the
 * course, check the actor may see it, and 403/404 on failure. `Astro.rewrite`
 * keeps the browser URL (unlike `Astro.redirect`), which is what lets the 403
 * page name the course the visitor was trying to reach. Also hands back the
 * course's `href`, so the same five-line `courseHref(...)` call isn't
 * repeated on every page.
 *
 * Pass `manage: true` on instructor-only pages (`/manage`, `/roster`) to
 * also require `enrollment.manage`, not just visibility — the same
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
		course = await db.course.findOne(
			{
				discipline: disciplineSlug,
				instructor: parsed.instructor,
				edition: parsed.edition,
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
	if (opts?.manage && !hasPerm(actor, "enrollment.manage", course)) {
		return { redirect: await forbidden(Astro, segment) };
	}

	return {
		course,
		href: courseHref({
			discipline: course.discipline.slug,
			instructor: course.instructor.username,
			edition: course.edition.slug,
		}),
	};
}

function forbidden(Astro: AstroGlobal, courseName: string): Promise<Response> {
	const url = new URL("/403", Astro.url);
	url.searchParams.set("course", courseName);
	return Astro.rewrite(url);
}
