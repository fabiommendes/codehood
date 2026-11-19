/**
 * When the text answers of an exam are saved while the student types: at most
 * one save per interval for each question, counted from its first unsaved edit.
 */

export interface SaveScheduleOptions<TimerId = ReturnType<typeof setTimeout>> {
	/// The longest an edit waits to be saved, in milliseconds.
	intervalMs: number;
	/// Saves the answer of the question `slug`.
	save: (slug: string) => void;
	/// Replace the platform's timers, for a test that drives time by hand.
	setTimer?: (run: () => void, ms: number) => TimerId;
	clearTimer?: (id: TimerId) => void;
}

export interface SaveSchedule {
	/// Notes an edit of `slug`: its save is due one interval after the first edit still unsaved.
	edited(slug: string): void;
	/// Forgets the save due for `slug`, because it is being saved now.
	cancel(slug: string): void;
	/// Forgets every save due.
	dispose(): void;
}

/**
 * Creates the schedule of the saves of text answers.
 *
 * An edit that follows an unsaved one never postpones the save already due, so a student who types without a pause is still saved every interval.
 *
 * @example
 * const schedule = createSaveSchedule({ intervalMs: 30_000, save: saveNow });
 * schedule.edited("q1"); // `saveNow("q1")` runs in 30 s, however much is typed meanwhile
 */
export function createSaveSchedule<TimerId = ReturnType<typeof setTimeout>>(
	options: SaveScheduleOptions<TimerId>,
): SaveSchedule {
	const setTimer =
		options.setTimer ??
		((run: () => void, ms: number) => setTimeout(run, ms) as TimerId);
	const clearTimer =
		options.clearTimer ??
		((id: TimerId) => clearTimeout(id as ReturnType<typeof setTimeout>));
	const due = new Map<string, TimerId>();

	function cancel(slug: string): void {
		const timer = due.get(slug);
		if (timer === undefined) return;
		clearTimer(timer);
		due.delete(slug);
	}

	return {
		edited(slug) {
			if (due.has(slug)) return;
			due.set(
				slug,
				setTimer(() => {
					due.delete(slug);
					options.save(slug);
				}, options.intervalMs),
			);
		},
		cancel,
		dispose() {
			for (const slug of [...due.keys()]) cancel(slug);
		},
	};
}
