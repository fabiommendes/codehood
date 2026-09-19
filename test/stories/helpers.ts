import { expect, type Page } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db, type UserCreate } from "@/db";
import type { Weekday } from "@/db/client";
import { prisma } from "@/db/client";
import { persistedUserFactory, userFactory } from "@/fixtures/user.factory";
import { SERVER_TZ } from "@/utils/schedule-time";

/**
 * Mirrors `SESSION_COOKIE` in `src/middleware.ts`.
 *
 * Importing it from there would pull in `astro:middleware`, a virtual module
 * that only exists inside Astro's build — the test process cannot resolve it.
 */
const SESSION_COOKIE = "session";

/** Where `playwright.config.ts` serves the build under test. */
const BASE_URL = "http://localhost:4322";

/**
 * Empties every table, so a story starts from a world it fully controls.
 *
 * The wipe has to be a committed delete rather than a transaction the test
 * rolls back: the server under test is a separate process (see
 * `playwright.config.ts`), and one process cannot see another's uncommitted
 * rows. For the same reason the database cannot be `:memory:` — that is
 * private to a single connection.
 *
 * This also removes the dev accounts and demo courses `src/db/bootstrap.ts`
 * seeds. The server memoizes that seeding per process, so it will not put them
 * back; a story that wants a fixture creates it with a factory.
 */
export async function resetDatabase(): Promise<void> {
	const tables = await prisma.$queryRaw<{ name: string }[]>`
		SELECT name FROM sqlite_master
		WHERE type = 'table'
		  AND name NOT LIKE 'sqlite_%'
		  AND name NOT LIKE '_prisma%'
	`;

	await prisma.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
	try {
		for (const { name } of tables) {
			await prisma.$executeRawUnsafe(`DELETE FROM "${name}"`);
		}
	} finally {
		await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");
	}
}

/**
 * Seeds a user and hands back the payload it was built from.
 *
 * `persistedUserFactory.create()` returns a `User`, which deliberately has no
 * plaintext password — but a story that logs in through the form needs one.
 * Building first and persisting that exact payload keeps both.
 */
export async function seedUser(
	params: Partial<UserCreate> = {},
): Promise<UserCreate> {
	const input = userFactory.build(params);
	await persistedUserFactory.create(input);
	return input;
}

/** Credentials the login form needs — any factory-built `UserCreate` has them. */
type Credentials = Pick<UserCreate, "username" | "password">;

/**
 * Signs in through the login form, the way a user does.
 *
 * Fields are reached through their `<fieldset>` group because the forms in this
 * codebase name inputs with a `<legend>`, which labels the group rather than
 * the field — `getByLabel("Password")` matches nothing on `/login` today. The
 * password field needs a raw `input` locator on top of that, since a password
 * input carries no ARIA role and `getByRole("textbox")` cannot see it. Give
 * those inputs real labels and this collapses to two `getByLabel().fill()`
 * calls.
 */
export async function logIn(page: Page, user: Credentials): Promise<void> {
	await page.goto("/login");
	await fillField(page, "Email or username", user.username);
	await fillField(page, "Password", user.password);
	await page.getByRole("button", { name: "Log in" }).click();
	await expect(page).not.toHaveURL(/\/login$/);
}

/**
 * Starts the page already signed in as `user`, skipping the login form.
 *
 * Use this whenever being logged in is background rather than the story: it
 * turns four page interactions and a navigation into one database write. Only
 * a story that is *about* logging in should call {@link logIn}.
 *
 * This is not an authentication bypass, and deliberately so — no test-only
 * header or short-circuit exists in `src/`, where it could reach production.
 * It mints a genuine session through `sessionService.create` and hands the
 * browser the same cookie `auth.login` would have set, so the middleware
 * validates it by the ordinary path. The server reads the row because both
 * processes share the test database file.
 */
export async function logInAs(
	page: Page,
	user: Pick<UserCreate, "username">,
): Promise<void> {
	const { token, session } = await db.session.create(
		{ username: user.username },
		FULL_ACCESS,
	);
	await page.context().addCookies([
		{
			name: SESSION_COOKIE,
			value: token,
			url: BASE_URL,
			httpOnly: true,
			sameSite: "Lax",
			expires: session.expiresAt.getTime() / 1000,
		},
	]);
}

/**
 * Switches to a same-page tab, e.g. "Account" on `/profile`.
 *
 * `Tabs.astro` renders these as radio inputs whose `aria-label` is the visible
 * label, and reveals the matching panel with a `:has()` rule — so the panel's
 * controls are genuinely not interactive until the tab is picked, exactly as
 * for a person.
 */
export async function openTab(page: Page, label: string): Promise<void> {
	await page.getByRole("radio", { name: label, exact: true }).check();
}

/**
 * Fills the input inside the `<fieldset>` whose `<legend>` reads `label`.
 *
 * See {@link logIn} for why this is not `getByLabel`.
 */
export async function fillField(
	page: Page,
	label: string,
	value: string,
): Promise<void> {
	// `exact` matters: without it `name` matches as a substring, so "Name"
	// would find the "Username" fieldset and "Password" would find "Confirm
	// password" — whichever comes first in the DOM.
	await page
		.getByRole("group", { name: label, exact: true })
		.locator("input, textarea")
		.first()
		.fill(value);
}

const WEEKDAY_ORDER: readonly Weekday[] = [
	"SUNDAY",
	"MONDAY",
	"TUESDAY",
	"WEDNESDAY",
	"THURSDAY",
	"FRIDAY",
	"SATURDAY",
];

/**
 * A calendar date `daysAhead` days from today and the {@link Weekday} it
 * falls on, both read in `SERVER_TZ` — the same zone
 * `calendarEventService.create` interprets an authored `date` in.
 *
 * A calendar-event fixture needs a `date`/slot-`day` pair that actually
 * matches (the service rejects a mismatch) and, for a story about "what's
 * coming up", one that is genuinely in the future. Building the pair from
 * `new Date()` in the local Node timezone would drift from `SERVER_TZ` and
 * occasionally hand back yesterday or the wrong weekday; this reads today's
 * date the same way the server does, then adds whole days as calendar math
 * rather than a duration, so it can never straddle a DST change.
 */
export function futureDate(daysAhead: number): { date: string; day: Weekday } {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: SERVER_TZ,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(new Date());
	const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
	const today = Date.UTC(
		Number(map.year),
		Number(map.month) - 1,
		Number(map.day),
	);
	const target = new Date(today + daysAhead * 86_400_000);
	return {
		date: target.toISOString().slice(0, 10),
		day: WEEKDAY_ORDER[target.getUTCDay()] as Weekday,
	};
}
