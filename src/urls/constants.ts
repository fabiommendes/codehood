/** `^[a-z][a-z0-9-]{1,30}[a-z0-9]$` — lowercase, starts with a letter, no trailing hyphen. */
export const DISCIPLINE_SLUG_RE = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;

/** Validate usernames. Some usernames are reserved and not covered in this REGEX. */
export const USERNAME_RE = /^[a-z0-9][a-z0-9_-]{1,30}$/;

/** Usually a YYYY-NN, where the last part after the dash is optional. */
export const EDITION_RE = /^[0-9]{4}(-([1-9][0-9]*|0))?$/;

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
	"calendar",
	"courses",
	"design",
	"favicon",
	"files",
	"getting-started",
	"img",
	"invite",
	"login",
	"logo",
	"manifest",
	"profile",
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
 * Those names are forbidden in the platform
 */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set(["_"]);
