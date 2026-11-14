/**
 * Names and credentials the load-test seed creates and the load uses.
 */

const EDITION = `${new Date().getFullYear()}-${new Date().getMonth() < 6 ? 1 : 2}`;

export const LOAD = {
	discipline: "loadtest",
	instructor: "loadteacher",
	edition: EDITION,
	courseSegment: `loadteacher_${EDITION}`,
	exam: "load-quiz",
	password: "load-password",
	/// The instructor's `BOT` key the chalk-worker authenticates with.
	botKey: "load-bot-key",
	student: (index: number) => `load${String(index).padStart(3, "0")}`,
} as const;
