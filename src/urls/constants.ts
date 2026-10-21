/** `^[a-z][a-z0-9\-]{1,30}[a-z0-9]$` — lowercase, starts with a letter, no trailing hyphen. */
export const DISCIPLINE_SLUG_RE = /^[a-z][a-z0-9\-]{1,30}[a-z0-9]$/;

/** Validate usernames as stored and as they appear in URLs: lowercase only. */
export const USERNAME_RE = /^[a-z0-9][a-z0-9_\-]{1,30}$/;

/** {@link USERNAME_RE} with uppercase letters too: what a person may type before it is lowercased. */
export const USERNAME_INPUT_RE = /^[A-Za-z0-9][A-Za-z0-9_\-]{1,30}$/;

/** A YYYY or YYYY-N, where the term N has at most two digits and no leading zero. */
export const EDITION_RE = /^[0-9]{4}(-([1-9][0-9]?|0))?$/;

/**
 * Top-level names a discipline slug must not equal, because the root
 * namespace is shared with every system route. Includes both routes that
 * exist today and a buffer of names reserved for future use.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
	"403",
	"404",
	"500",
	"_actions",
	"_astro",
	"_image",
	"admin",
	"api",
	"c",
	"calendar",
	"check-in",
	"courses",
	"design",
	"favicon",
	"files",
	"getting-started",
	"home",
	"img",
	"invite",
	"login",
	"logo",
	"manifest",
	"profile",
	"rpc",
	"sw",
	"about",
	"docs",
	"help",
	"logout",
	"me",
	"new",
	"search",
	"settings",
	"signup",
	"static",
	"users",
]);

/**
 * Names a new account may not take.
 *
 * `me` is shadowed by `/api/user/me`; the rest would let an account pass for
 * staff or for the system itself. `admin` stays free for the instance's own
 * administrator account. Accounts that already hold one keep it.
 */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
	"administrator",
	"anonymous",
	"codehood",
	"me",
	"null",
	"root",
	"staff",
	"support",
	"system",
	"undefined",
]);
