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
import FormAlert from "@/components/form/FormAlert";
import { errorMessage } from "@/forms/field-errors";
import { m } from "@/i18n";
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

/// A student's row as shown: the server's state, or what the instructor last set.
interface Draft {
	present: boolean;
	note: string;
}

/**
 * The instructor's view of a roll call: its state, and every enrolled student
 * with a presence switch that saves as it flips, and a note behind a button.
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
		setFailure(null);
		const { data, error } = await call();
		setBusy(false);
		if (error) {
			setFailure(errorMessage(error));
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
			setFailure(null);
			const { data, error } = await actions.rollCall.update({
				...target,
				attendances: { [username]: entry },
			});
			setPending(username, (count) => count - 1);
			if (error) setFailure(errorMessage(error));
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
			setFailure(errorMessage(error));
			return;
		}
		window.location.href = props.scheduleHref;
	}

	return (
		<div class="flex flex-col gap-4">
			<FormAlert error={failure() ?? undefined} />

			<div class="flex flex-wrap items-center gap-3">
				<span
					class="badge badge-lg"
					classList={{ "badge-success": isOpen(), "badge-neutral": !isOpen() }}
				>
					{isOpen()
						? m.attendance_manager_open()
						: m.attendance_manager_closed()}
				</span>
				<Show when={isOpen()}>
					<span class="font-mono text-sm">
						{m.attendance_closes_in({
							time: formatCountdown(server().closesAt.getTime() - now()),
						})}
					</span>
				</Show>
				<span class="flex-1" />
				<a class="btn btn-primary btn-sm" href={`${props.pageHref}/project`}>
					{m.attendance_manager_project()}
				</a>
				<Show
					when={isOpen()}
					fallback={
						<button
							type="button"
							class="btn btn-outline btn-sm"
							disabled={busy()}
							onClick={() => run(() => actions.rollCall.open(target))}
						>
							{m.attendance_manager_reopen()}
						</button>
					}
				>
					<button
						type="button"
						class="btn btn-outline btn-sm"
						disabled={busy()}
						onClick={() => run(() => actions.rollCall.close(target))}
					>
						{m.attendance_manager_close()}
					</button>
				</Show>
				<button
					type="button"
					class="btn btn-outline btn-error btn-sm"
					disabled={busy()}
					onClick={() => confirmDelete?.showModal()}
				>
					{m.attendance_manager_delete()}
				</button>
			</div>

			<div class="overflow-x-auto">
				<table class="table">
					<thead>
						<tr>
							<th>{m.attendance_table_col_student()}</th>
							<th>{m.attendance_table_col_present()}</th>
							<th />
						</tr>
					</thead>
					<tbody>
						<For each={props.students}>
							{(student) => {
								const entry = () => server().attendances[student.username];
								const draft = () => drafts[student.username];
								const note = () => editing[student.username];
								return (
									<tr classList={{ "opacity-50": student.dropped }}>
										<td>
											<div class="font-medium">{student.name}</div>
											<div class="flex flex-wrap gap-1">
												<Show when={student.dropped}>
													<span class="badge badge-ghost badge-sm">
														{m.attendance_table_dropped()}
													</span>
												</Show>
												<Show when={entry()?.joined}>
													<span class="badge badge-info badge-sm">
														{m.attendance_manager_new_in_class()}
													</span>
												</Show>
												<For each={entry()?.sharedWith ?? []}>
													{(other) => (
														<span class="badge badge-warning badge-sm">
															{m.attendance_manager_same_device({ other })}
														</span>
													)}
												</For>
											</div>
											<Show
												when={note() !== undefined}
												fallback={
													<Show when={draft()?.present && draft()?.note}>
														<p class="mt-1 text-sm text-base-content/70">
															{draft()?.note}
														</p>
													</Show>
												}
											>
												<form
													class="mt-2 flex flex-wrap gap-2"
													onSubmit={(e) => {
														e.preventDefault();
														saveNote(student.username);
													}}
												>
													<input
														type="text"
														class="input input-sm min-w-0 flex-1"
														aria-label={m.attendance_manager_col_note()}
														maxLength={200}
														value={note() ?? ""}
														ref={(el) => queueMicrotask(() => el.focus())}
														onInput={(e) =>
															setEditing(
																student.username,
																e.currentTarget.value,
															)
														}
														onKeyDown={(e) => {
															if (e.key === "Escape") {
																setEditing(student.username, undefined);
															}
														}}
													/>
													<button type="submit" class="btn btn-primary btn-sm">
														{m.attendance_manager_save_note()}
													</button>
													<button
														type="button"
														class="btn btn-ghost btn-sm"
														onClick={() =>
															setEditing(student.username, undefined)
														}
													>
														{m.attendance_cancel()}
													</button>
												</form>
											</Show>
										</td>
										<td>
											<input
												type="checkbox"
												class="toggle toggle-success"
												aria-label={m.attendance_table_col_present()}
												checked={draft()?.present ?? false}
												onChange={(e) =>
													save(student.username, {
														present: e.currentTarget.checked,
														note: draft()?.note ?? "",
													})
												}
											/>
										</td>
										<td class="text-right">
											<Show when={draft()?.present && note() === undefined}>
												<button
													type="button"
													class="btn btn-ghost btn-xs"
													onClick={() =>
														setEditing(student.username, draft()?.note ?? "")
													}
												>
													{draft()?.note
														? m.attendance_manager_edit_note()
														: m.attendance_manager_add_note()}
												</button>
											</Show>
										</td>
									</tr>
								);
							}}
						</For>
					</tbody>
				</table>
			</div>

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
