import { actions } from "astro:actions";
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

/// What the instructor is editing in a student's row.
interface Draft {
	present: boolean;
	note: string;
	dirty: boolean;
}

/**
 * The instructor's view of a roll call: its state, and every enrolled student
 * with a presence checkbox and a note.
 *
 * While the roll call is open it polls for check-ins. A row the instructor
 * has edited is left alone until saved.
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
	const [busy, setBusy] = createSignal(false);
	const [failure, setFailure] = createSignal<string | null>(null);
	const now = createNow(props.now);
	let confirmDelete: HTMLDialogElement | undefined;

	const isOpen = () => server().closesAt.getTime() > now();

	/// Takes a new server state, keeping the rows being edited.
	function adopt(next: Snapshot, saved?: string): void {
		setServer(next);
		const fresh: Record<string, Draft> = {};
		for (const student of props.students) {
			const current = drafts[student.username];
			if (current?.dirty && student.username !== saved) {
				fresh[student.username] = { ...current };
				continue;
			}
			const entry = next.attendances[student.username];
			fresh[student.username] = {
				present: entry !== undefined,
				note: entry?.note ?? "",
				dirty: false,
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
			error?: { message: string } | undefined;
		}>,
		saved?: string,
	): Promise<void> {
		setBusy(true);
		setFailure(null);
		const { data, error } = await call();
		setBusy(false);
		if (error) {
			setFailure(error.message);
			return;
		}
		if (data) adopt(data, saved);
	}

	function save(username: string): Promise<void> {
		const draft = drafts[username];
		const entry = draft?.present ? { note: draft.note.trim() || null } : null;
		return run(
			() =>
				actions.rollCall.update({
					...target,
					attendances: { [username]: entry },
				}),
			username,
		);
	}

	async function remove(): Promise<void> {
		setBusy(true);
		const { error } = await actions.rollCall.delete(target);
		if (error) {
			setBusy(false);
			confirmDelete?.close();
			setFailure(error.message);
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
					{isOpen() ? "Roll call open" : "Roll call closed"}
				</span>
				<Show when={isOpen()}>
					<span class="font-mono text-sm">
						Closes in {formatCountdown(server().closesAt.getTime() - now())}
					</span>
				</Show>
				<span class="flex-1" />
				<a class="btn btn-primary btn-sm" href={`${props.pageHref}/project`}>
					Project
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
							Reopen roll call
						</button>
					}
				>
					<button
						type="button"
						class="btn btn-outline btn-sm"
						disabled={busy()}
						onClick={() => run(() => actions.rollCall.close(target))}
					>
						Close roll call
					</button>
				</Show>
				<button
					type="button"
					class="btn btn-outline btn-error btn-sm"
					disabled={busy()}
					onClick={() => confirmDelete?.showModal()}
				>
					Delete
				</button>
			</div>

			<div class="overflow-x-auto">
				<table class="table">
					<thead>
						<tr>
							<th>Student</th>
							<th>Present</th>
							<th>Note</th>
							<th />
						</tr>
					</thead>
					<tbody>
						<For each={props.students}>
							{(student) => {
								const entry = () => server().attendances[student.username];
								const draft = () => drafts[student.username];
								return (
									<tr classList={{ "opacity-50": student.dropped }}>
										<td>
											<div class="font-medium">{student.name}</div>
											<div class="flex flex-wrap gap-1">
												<Show when={student.dropped}>
													<span class="badge badge-ghost badge-sm">
														Dropped
													</span>
												</Show>
												<Show when={entry()?.joined}>
													<span class="badge badge-info badge-sm">
														New in this class
													</span>
												</Show>
												<For each={entry()?.sharedWith ?? []}>
													{(other) => (
														<span class="badge badge-warning badge-sm">
															Same device as {other}
														</span>
													)}
												</For>
											</div>
										</td>
										<td>
											<input
												type="checkbox"
												class="checkbox"
												aria-label="Present"
												checked={draft()?.present ?? false}
												onChange={(e) =>
													setDrafts(student.username, {
														present: e.currentTarget.checked,
														dirty: true,
													})
												}
											/>
										</td>
										<td>
											<input
												type="text"
												class="input input-sm w-full"
												aria-label="Note"
												maxLength={200}
												value={draft()?.note ?? ""}
												onInput={(e) =>
													setDrafts(student.username, {
														note: e.currentTarget.value,
														dirty: true,
													})
												}
											/>
										</td>
										<td>
											<button
												type="button"
												class="btn btn-sm"
												classList={{ "btn-primary": draft()?.dirty }}
												disabled={busy()}
												onClick={() => save(student.username)}
											>
												Save
											</button>
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
					<h3 class="text-lg font-bold">Delete this roll call?</h3>
					<p class="mt-2 text-sm text-base-content/70">
						Every attendance recorded in it is lost. This cannot be undone.
					</p>
					<div class="modal-action">
						<button
							type="button"
							class="btn btn-ghost"
							onClick={() => confirmDelete?.close()}
						>
							Cancel
						</button>
						<button
							type="button"
							class="btn btn-error"
							disabled={busy()}
							onClick={remove}
						>
							Delete roll call
						</button>
					</div>
				</div>
				<form method="dialog" class="modal-backdrop">
					<button type="submit">close</button>
				</form>
			</dialog>
		</div>
	);
}
