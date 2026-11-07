import type { AstroCookies } from "astro";
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from "@/core/constants";

/**
 * The attributes a session cookie deletion must carry to match how it was set.
 *
 * Browsers ignore a `__Host-` Set-Cookie without `Secure`, so the removal has
 * to repeat the options of the original cookie.
 */
export function sessionCookieClearOptions(
	options: typeof SESSION_COOKIE_OPTIONS = SESSION_COOKIE_OPTIONS,
) {
	return { ...options };
}

/** Deletes the session cookie in a way the browser accepts in every environment. */
export function clearSessionCookie(cookies: AstroCookies): void {
	cookies.delete(SESSION_COOKIE, sessionCookieClearOptions());
}
