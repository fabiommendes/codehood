// A user's calendar feed, `GET /calendar/<token>.ics`. The token in the path
// is the only credential: the session cookie is never read, so a browser
// signed in as someone else gets the same answer as a calendar app.
import type { APIRoute } from "astro";
import { db } from "@/db";
import { locale, m } from "@/i18n";
import { renderCalendar } from "@/services/calendar-feed";
import { loadCalendarFeed } from "@/utils/load-calendar-feed";

export const prerender = false;

export const GET: APIRoute = async ({ params, url }) => {
	const owner = await db.calendarFeed.resolve(params.token ?? "");
	// Unknown and malformed tokens get the same bare 404.
	if (!owner) return new Response(null, { status: 404 });

	const { entries, courses } = await loadCalendarFeed(owner, new Date());
	const body = renderCalendar(entries, {
		origin: url.origin,
		name: m.schedule_feed_name({ name: owner.name }),
		locale,
		courses: new Map(courses.map((course) => [course.id, course])),
	});

	return new Response(body, {
		headers: {
			"content-type": "text/calendar; charset=utf-8",
			"cache-control": "private, max-age=300",
		},
	});
};
