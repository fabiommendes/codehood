import { type ActionError, actions } from "astro:actions";
import {
	createSignal,
	For,
	type JSX,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { errorMessage } from "@/forms/field-errors";
import { m } from "@/i18n";
import { formatDateTime } from "@/utils/schedule-time";
import { createNow, formatCountdown } from "./countdown";

/// One attendance as the roll call actions return it.
interface AttendanceView {
	note: string | null;
	joined: "ENROLLMENT" | "ACCOUNT" | null;
	sharedWith: string[];
}

/// The roll call state the actions return.
interface Snapshot {
	closesAt: Date;
	attendances: Record<string, AttendanceView>;
}

export interface RollCallManagerProps {
	/// The roll call's address, as the roll call actions take it.
	discipline: string;
	course: string;
	week: number;
	timeSlot: string;
	/// The roll call page's URL; the projection lives under it.
	pageHref: string;
	/// The course's schedule URL, where a deleted roll call sends the instructor.
	scheduleHref: string;
	students: { username: string; name: string; dropped: boolean }[];
	initial: Snapshot;
	/// Server time when the page rendered, in milliseconds.
	now: number;
}

/// How often an open roll call asks the server for new check-ins.
const POLL_MS = 5000;

/// How long an error stays on screen.
const FAILURE_MS = 8000;

/// A student's row as shown: the server's state, or what the instructor last set.
interface Draft {
	present: boolean;
	note: string;
}

/**
 * The instructor's view of a roll call: its state, and every enrolled student
 * with a presence switch that saves as it flips, and a note behind a button.
 *
 * Nothing on the page moves as its state changes: rows have a fixed height,
 * controls that come and go keep their space, labels that swap reserve the
 * width of the widest, and errors show in a toast over the page.
 *
 * While the roll call is open it polls for check-ins. A row with a save on the
 * way, or a note being written, is left alone until it settles. Saves run one
 * at a time, in the order they were made.
 */
export default function RollCallManager(
	props: RollCallManagerProps,
): JSX.Element {
	const target = {
		discipline: props.discipline,
		course: props.course,
		week: props.week,
		timeSlot: props.timeSlot,
	};
	const [server, setServer] = createSignal<Snapshot>(props.initial);
	const [drafts, setDrafts] = createStore<Record<string, Draft>>({});
	/// Saves queued or running per row.
	const [pending, setPending] = createStore<Record<string, number>>({});
	/// The note text of rows whose note is open for editing.
	const [editing, setEditing] = createStore<Record<string, string | undefined>>(
		{},
	);
	const [busy, setBusy] = createSignal(false);
	const [failure, setFailure] = createSignal<string | null>(null);
	const now = createNow(props.now);
	let confirmDelete: HTMLDialogElement | undefined;

	const isOpen = () => server().closesAt.getTime() > now();
	const presentCount = () =>
		props.students.filter((s) => drafts[s.username]?.present).length;

	let failureTimer: ReturnType<typeof setTimeout> | undefined;
	onCleanup(() => clearTimeout(failureTimer));

	/// Shows `message` in a toast that goes away on its own after a while.
	function fail(message: string): void {
		setFailure(message);
		clearTimeout(failureTimer);
		failureTimer = setTimeout(() => setFailure(null), FAILURE_MS);
	}

	/// Whether the row of `username` has a save on the way or a note open.
	const unsettled = (username: string) =>
		(pending[username] ?? 0) > 0 || editing[username] !== undefined;

	/// Takes a new server state, keeping the rows that have not settled.
	function adopt(next: Snapshot): void {
		setServer(next);
		const fresh: Record<string, Draft> = {};
		for (const student of props.students) {
			const current = drafts[student.username];
			if (current && unsettled(student.username)) {
				fresh[student.username] = { ...current };
				continue;
			}
			const entry = next.attendances[student.username];
			fresh[student.username] = {
				present: entry !== undefined,
				note: entry?.note ?? "",
			};
		}
		setDrafts(reconcile(fresh));
	}
	adopt(props.initial);

	async function refresh(): Promise<void> {
		if (!isOpen()) return;
		const { data } = await actions.rollCall.get(target);
		if (data) adopt(data);
	}

	onMount(() => {
		const timer = setInterval(refresh, POLL_MS);
		onCleanup(() => clearInterval(timer));
	});

	/// Runs a roll call action and adopts the state it returns.
	async function run(
		call: () => Promise<{
			data?: Snapshot | undefined;
			error?: ActionError | undefined;
		}>,
	): Promise<void> {
		setBusy(true);
		const { data, error } = await call();
		setBusy(false);
		if (error) {
			fail(errorMessage(error));
			return;
		}
		if (data) adopt(data);
	}

	/// The tail of the save queue.
	let saving: Promise<void> = Promise.resolve();

	/// Shows `draft` in the row of `username` at once and queues saving it.
	function save(username: string, draft: Draft): void {
		setDrafts(username, draft);
		setPending(username, (count) => (count ?? 0) + 1);
		const entry = draft.present ? { note: draft.note.trim() || null } : null;
		saving = saving.then(async () => {
			const { data, error } = await actions.rollCall.update({
				...target,
				attendances: { [username]: entry },
			});
			setPending(username, (count) => count - 1);
			if (error) fail(errorMessage(error));
			// On a failure this puts the row back as the server has it.
			adopt(data ?? server());
		});
	}

	function saveNote(username: string): void {
		const note = editing[username] ?? "";
		setEditing(username, undefined);
		save(username, { present: true, note });
	}

	async function remove(): Promise<void> {
		setBusy(true);
		const { error } = await actions.rollCall.delete(target);
		if (error) {
			setBusy(false);
			confirmDelete?.close();
			fail(errorMessage(error));
			return;
		}
		window.location.href = props.scheduleHref;
	}

	return (
		<div class="flex flex-col gap-4">
			<section class="card border border-base-content/15 bg-base-200/50">
				<div class="card-body flex-row flex-wrap items-center gap-x-4 gap-y-3 p-4">
					<div class="flex items-center gap-3">
						<span
							class="badge"
							classList={{
								"badge-success": isOpen(),
								"badge-neutral": !isOpen(),
							}}
						>
							<Reserve
								widest={[
									m.attendance_manager_open(),
									m.attendance_manager_closed(),
								]}
							>
								{isOpen()
									? m.attendance_manager_open()
									: m.attendance_manager_closed()}
							</Reserve>
						</span>
						<span
							class="font-mono text-sm tabular-nums"
							classList={{ "text-base-content/60": !isOpen() }}
						>
							<Reserve
								widest={[
									m.attendance_closes_in({ time: "00:00" }),
									m.attendance_manager_closed_at({ time: "00:00" }),
								]}
							>
								{isOpen()
									? m.attendance_closes_in({
											time: formatCountdown(
												server().closesAt.getTime() - now(),
											),
										})
									: m.attendance_manager_closed_at({
											time: formatDateTime(server().closesAt, {
												weekday: undefined,
												month: undefined,
												day: undefined,
											}),
										})}
							</Reserve>
						</span>
					</div>
					<span class="text-sm text-base-content/70 tabular-nums">
						<Reserve
							widest={[
								m.attendance_manager_summary({
									present: props.students.length,
									total: props.students.length,
								}),
							]}
						>
							{m.attendance_manager_summary({
								present: presentCount(),
								total: props.students.length,
							})}
						</Reserve>
					</span>
					<div class="ml-auto flex gap-2">
						<a
							class="btn btn-primary btn-sm"
							href={`${props.pageHref}/project`}
						>
							{m.attendance_manager_project()}
						</a>
						<button
							type="button"
							class="btn btn-outline btn-sm"
							aria-label={
								isOpen()
									? m.attendance_manager_close()
									: m.attendance_manager_reopen()
							}
							disabled={busy()}
							onClick={() =>
								run(() =>
									isOpen()
										? actions.rollCall.close(target)
										: actions.rollCall.open(target),
								)
							}
						>
							<Reserve
								widest={[
									m.attendance_manager_close(),
									m.attendance_manager_reopen(),
								]}
							>
								{isOpen()
									? m.attendance_manager_close()
									: m.attendance_manager_reopen()}
							</Reserve>
						</button>
						<button
							type="button"
							class="btn btn-outline btn-error btn-sm"
							disabled={busy()}
							onClick={() => confirmDelete?.showModal()}
						>
							{m.attendance_manager_delete()}
						</button>
					</div>
				</div>
			</section>

			<div class="overflow-hidden rounded-box border border-base-content/15">
				<table class="table table-fixed">
					<thead>
						<tr>
							<th class="px-3 sm:px-4">{m.attendance_table_col_student()}</th>
							<th class="w-24 px-2 sm:w-28">
								{m.attendance_table_col_present()}
							</th>
							<th class="w-14 px-2">
								<span class="sr-only">{m.attendance_manager_col_note()}</span>
							</th>
						</tr>
					</thead>
					<tbody>
						<For each={props.students}>
							{(student) => {
								const entry = () => server().attendances[student.username];
								const draft = () => drafts[student.username];
								const present = () => draft()?.present ?? false;
								const note = () => (present() ? (draft()?.note ?? "") : "");
								const saving = () => (pending[student.username] ?? 0) > 0;
								return (
									<tr
										class="hover:bg-base-200/40"
										aria-busy={saving() ? "true" : undefined}
									>
										<td class="px-3 py-2 sm:px-4">
											<div classList={{ "opacity-60": student.dropped }}>
												<div class="truncate font-medium leading-5">
													{student.name}
												</div>
												<div class="flex h-5 items-center gap-1.5 overflow-hidden whitespace-nowrap text-xs">
													<span class="shrink-0 font-mono text-base-content/60">
														{student.username}
													</span>
													<Show when={student.dropped}>
														<span
															class="badge badge-ghost badge-xs min-w-0"
															title={m.attendance_table_dropped()}
														>
															<span class="truncate">
																{m.attendance_table_dropped()}
															</span>
														</span>
													</Show>
													<Show when={entry()?.joined}>
														<span
															class="badge badge-info badge-xs min-w-0"
															title={m.attendance_manager_new_in_class()}
														>
															<span class="truncate">
																{m.attendance_manager_new_in_class()}
															</span>
														</span>
													</Show>
													<For each={entry()?.sharedWith ?? []}>
														{(other) => (
															<span
																class="badge badge-warning badge-xs min-w-0"
																title={m.attendance_manager_same_device({
																	other,
																})}
															>
																<span class="truncate">
																	{m.attendance_manager_same_device({ other })}
																</span>
															</span>
														)}
													</For>
													<Show when={note()}>
														<span
															class="min-w-0 truncate italic text-base-content/70"
															title={note()}
														>
															{note()}
														</span>
													</Show>
												</div>
											</div>
										</td>
										<td class="px-2 py-2">
											<div class="flex items-center gap-2">
												<input
													type="checkbox"
													class="toggle toggle-success"
													aria-label={m.attendance_table_col_present()}
													checked={present()}
													onChange={(e) =>
														save(student.username, {
															present: e.currentTarget.checked,
															note: draft()?.note ?? "",
														})
													}
												/>
												<span
													class="loading loading-spinner loading-xs text-base-content/50"
													classList={{ invisible: !saving() }}
													role="status"
													aria-label={m.attendance_manager_saving()}
												/>
											</div>
										</td>
										<td class="px-2 py-2 text-right">
											<button
												type="button"
												class="btn btn-ghost btn-sm btn-square transition-opacity"
												classList={{
													"invisible opacity-0": !present(),
													"text-primary": Boolean(note()),
												}}
												aria-label={
													note()
														? m.attendance_manager_edit_note()
														: m.attendance_manager_add_note()
												}
												title={
													note()
														? m.attendance_manager_edit_note()
														: m.attendance_manager_add_note()
												}
												disabled={!present()}
												onClick={() => setEditing(student.username, note())}
											>
												<NoteIcon filled={Boolean(note())} />
											</button>
											<Show when={editing[student.username] !== undefined}>
												<NoteDialog
													name={student.name}
													value={editing[student.username] ?? ""}
													onInput={(value) =>
														setEditing(student.username, value)
													}
													onSave={() => saveNote(student.username)}
													onCancel={() =>
														setEditing(student.username, undefined)
													}
												/>
											</Show>
										</td>
									</tr>
								);
							}}
						</For>
					</tbody>
				</table>
			</div>

			<Show when={failure()}>
				<div class="toast toast-end toast-bottom z-50">
					<div role="alert" class="alert alert-error max-w-sm text-sm">
						<span class="whitespace-normal">{failure()}</span>
						<button
							type="button"
							class="btn btn-ghost btn-xs btn-square"
							aria-label={m.attendance_manager_dismiss()}
							onClick={() => setFailure(null)}
						>
							✕
						</button>
					</div>
				</div>
			</Show>

			<dialog ref={confirmDelete} class="modal">
				<div class="modal-box">
					<h3 class="text-lg font-bold">
						{m.attendance_manager_delete_title()}
					</h3>
					<p class="mt-2 text-sm text-base-content/70">
						{m.attendance_manager_delete_body()}
					</p>
					<div class="modal-action">
						<button
							type="button"
							class="btn btn-ghost"
							onClick={() => confirmDelete?.close()}
						>
							{m.attendance_cancel()}
						</button>
						<button
							type="button"
							class="btn btn-error"
							disabled={busy()}
							onClick={remove}
						>
							{m.attendance_manager_delete_confirm()}
						</button>
					</div>
				</div>
				<form method="dialog" class="modal-backdrop">
					<button type="submit">{m.attendance_close_backdrop()}</button>
				</form>
			</dialog>
		</div>
	);
}

/// Shows `children` in a box as wide as the widest of `widest`, so swapping
/// between them leaves the layout alone. Takes at most two alternatives.
function Reserve(props: {
	widest: string[];
	children: JSX.Element;
}): JSX.Element {
	return (
		<span
			class="inline-grid before:invisible before:col-start-1 before:row-start-1 before:content-[attr(data-a)] after:invisible after:col-start-1 after:row-start-1 after:content-[attr(data-b)]"
			data-a={props.widest[0]}
			data-b={props.widest[1] ?? ""}
		>
			<span class="col-start-1 row-start-1">{props.children}</span>
		</span>
	);
}

/// A modal that edits a student's note, open from the moment it mounts.
function NoteDialog(props: {
	name: string;
	value: string;
	onInput: (value: string) => void;
	onSave: () => void;
	onCancel: () => void;
}): JSX.Element {
	let dialog: HTMLDialogElement | undefined;
	onMount(() => dialog?.showModal());
	return (
		<dialog
			ref={dialog}
			class="modal modal-bottom text-left sm:modal-middle"
			onClose={() =>
				dialog?.returnValue === "save" ? props.onSave() : props.onCancel()
			}
		>
			<form
				class="modal-box flex flex-col gap-4"
				onSubmit={(e) => {
					e.preventDefault();
					dialog?.close("save");
				}}
			>
				<h3 class="text-lg font-bold">
					{m.attendance_manager_note_title({ name: props.name })}
				</h3>
				<input
					type="text"
					class="input w-full"
					aria-label={m.attendance_manager_col_note()}
					maxLength={200}
					autofocus
					value={props.value}
					onInput={(e) => props.onInput(e.currentTarget.value)}
				/>
				<div class="modal-action mt-0">
					<button
						type="button"
						class="btn btn-ghost"
						onClick={() => dialog?.close()}
					>
						{m.attendance_cancel()}
					</button>
					<button type="submit" class="btn btn-primary">
						{m.attendance_manager_save_note()}
					</button>
				</div>
			</form>
			<form method="dialog" class="modal-backdrop">
				<button type="submit">{m.attendance_close_backdrop()}</button>
			</form>
		</dialog>
	);
}

/// A speech bubble, outlined with a plus for a new note, with lines once
/// there is one.
function NoteIcon(props: { filled: boolean }): JSX.Element {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			class="h-5 w-5"
			aria-hidden="true"
		>
			<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
			<Show when={props.filled} fallback={<path d="M12 7v6M9 10h6" />}>
				<path d="M8 8h8M8 12h5" />
			</Show>
		</svg>
	);
}
