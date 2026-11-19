import { actions } from "astro:actions";
import type { JSX } from "solid-js";
import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { createSchemaForm } from "@/components/form/create-schema-form";
import Field from "@/components/form/Field";
import FormAlert from "@/components/form/FormAlert";
import SearchableTable from "@/components/ui/SearchableTable";
import type { ColumnConfig } from "@/components/ui/Table";
import {
	assignmentStaffCreate,
	assignmentStaffRename,
} from "@/core/schemas/assignment-actions";
import { errorMessage } from "@/forms/field-errors";
import { m } from "@/i18n";
import { formatDateTime } from "@/utils/schedule-time";

/// A student of the course, as the dialogs list them.
export interface ManagedStudent {
	username: string;
	name: string;
}

/// The commit of a delivery and when it arrived, the instant as ISO text.
export interface ManagedDelivery {
	sha: string;
	at: string;
}

/// How a team's size departs from what the assignment asks for.
export type SizeException = "above" | "below" | "empty";

export interface ManagedTeam {
	/// The team's public id, which the actions take.
	id: string;
	name: string;
	members: ManagedStudent[];
	/// Replaces the assignment's due date for this team, as an ISO instant.
	dueAt: string | null;
	pushes: number;
	sizeException: SizeException | null;
	onTime: ManagedDelivery | null;
	late: ManagedDelivery | null;
}

/// One row of an individual assignment: a student and their own repository.
export interface ManagedRepository {
	student: ManagedStudent;
	/// False until the student creates the repository.
	created: boolean;
	dueAt: string | null;
	onTime: ManagedDelivery | null;
	late: ManagedDelivery | null;
}

export interface ManagerData {
	/// The URL segments of the course and the slug, which every action takes.
	params: { discipline: string; course: string; slug: string };
	teamMin: number;
	teamMax: number;
	students: ManagedStudent[];
	teams: ManagedTeam[];
	repositories: ManagedRepository[];
}

/// What a dialog is about; every field but the kind depends on it.
interface DialogState {
	kind:
		| "add-member"
		| "move-member"
		| "delete-team"
		| "rename"
		| "assign-student"
		| "create-team";
	team?: string;
	student?: string;
}

interface Props {
	data: ManagerData;
}

/// Instant `iso` as a short date and time, e.g. "Nov 18, 14:32".
function when(iso: string): string {
	return formatDateTime(new Date(iso), { weekday: undefined });
}

/// Lowercase without accents, for matching a search.
function fold(text: string): string {
	return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function matches(student: ManagedStudent, query: string): boolean {
	const words = fold(query).split(/\s+/).filter(Boolean);
	const text = fold(`${student.name} ${student.username}`);
	return words.every((word) => text.includes(word));
}

/// A person with a plus beside them.
const ADD_STUDENT_ICON =
	"M15 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9 10.5a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5ZM19 8v6M16 11h6";

/// The on-time and the late delivery of a team, each on two lines.
function Deliveries(props: {
	onTime: ManagedDelivery | null;
	late: ManagedDelivery | null;
}): JSX.Element {
	const line = (delivery: ManagedDelivery, label: string, tone: string) => (
		<div class="whitespace-nowrap leading-tight">
			<div class="flex items-baseline gap-1.5">
				<span class={`text-xs font-medium ${tone}`}>{label}</span>
				<code class="rounded bg-base-300 px-1 font-mono text-xs">
					{delivery.sha.slice(0, 7)}
				</code>
			</div>
			<div class="text-xs text-muted">{when(delivery.at)}</div>
		</div>
	);
	return (
		<Show
			when={props.onTime || props.late}
			fallback={
				<span class="text-sm text-muted">{m.assignments_no_delivery()}</span>
			}
		>
			<div class="flex flex-col gap-1.5">
				<Show when={props.onTime}>
					{(d) =>
						line(d(), m.assignments_delivery_label_on_time(), "text-success")
					}
				</Show>
				<Show when={props.late}>
					{(d) =>
						line(d(), m.assignments_delivery_label_late(), "text-warning")
					}
				</Show>
			</div>
		</Show>
	);
}

/// Row actions that fit no line of the table, in a menu drawn on the body so the
/// table's scroll area cannot clip it.
function RowMenu(props: {
	label: string;
	items: { text: string; danger?: boolean; run: () => void }[];
}): JSX.Element {
	const [rect, setRect] = createSignal<DOMRect | null>(null);
	const hide = () => setRect(null);
	const up = () => {
		const r = rect();
		return r !== null && r.bottom + 110 > window.innerHeight;
	};
	return (
		<>
			<button
				type="button"
				class="btn btn-ghost btn-xs px-1.5"
				aria-label={props.label}
				aria-haspopup="menu"
				aria-expanded={rect() !== null}
				onClick={(event) =>
					rect() ? hide() : setRect(event.currentTarget.getBoundingClientRect())
				}
			>
				<svg
					viewBox="0 0 24 24"
					class="size-4"
					fill="currentColor"
					aria-hidden="true"
				>
					<circle cx="5" cy="12" r="2" />
					<circle cx="12" cy="12" r="2" />
					<circle cx="19" cy="12" r="2" />
				</svg>
			</button>
			<Show when={rect()}>
				{(r) => (
					<Portal>
						<button
							type="button"
							class="fixed inset-0 z-40 cursor-default"
							aria-label={m.assignments_close_menu()}
							onClick={hide}
						/>
						<ul
							class="menu menu-sm fixed z-50 w-40 rounded-box border border-base-content/15 bg-base-100 p-1 shadow-lg"
							style={{
								left: `${Math.max(8, r().right - 160)}px`,
								...(up()
									? { bottom: `${window.innerHeight - r().top + 4}px` }
									: { top: `${r().bottom + 4}px` }),
							}}
						>
							<For each={props.items}>
								{(item) => (
									<li>
										<button
											type="button"
											class={item.danger ? "text-error" : ""}
											onClick={() => {
												hide();
												item.run();
											}}
										>
											{item.text}
										</button>
									</li>
								)}
							</For>
						</ul>
					</Portal>
				)}
			</Show>
		</>
	);
}

/// Icon paths of each size exception, drawn on a 16-unit grid.
const SIZE_ICONS: Record<SizeException, string> = {
	above: "M8 13V3M4 7l4-4 4 4",
	below: "M8 3v10M4 9l4 4 4-4",
	empty: "M2.5 4.5h11v3h-11zM3.5 7.5v5h9v-5M6.5 10h3",
};

/// The size of a team, with a coloured icon and a tooltip when it is an exception.
function TeamSize(props: {
	size: number;
	pushes: number;
	exception: SizeException | null;
	min: number;
	max: number;
}): JSX.Element {
	const tip = (exception: SizeException) => {
		const range = m.assignments_size_range({ min: props.min, max: props.max });
		switch (exception) {
			case "above":
				return m.assignments_size_above({ range });
			case "below":
				return m.assignments_size_below({ range });
			case "empty":
				return m.assignments_size_empty({ count: props.pushes });
		}
	};
	return (
		<Show
			when={props.exception}
			fallback={<span class="px-1.5">{props.size}</span>}
		>
			{(current) => (
				<span
					class="tooltip tooltip-left"
					data-tip={tip(current())}
					tabindex="0"
				>
					<span
						class="badge badge-soft badge-sm gap-0.5 px-1.5 font-medium"
						classList={{
							"badge-warning": current() !== "empty",
							"badge-info": current() === "empty",
						}}
					>
						{props.size}
						<svg
							viewBox="0 0 16 16"
							class="size-3"
							fill="none"
							stroke="currentColor"
							stroke-width="1.8"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d={SIZE_ICONS[current()]} />
						</svg>
						<span class="sr-only">{tip(current())}</span>
					</span>
				</span>
			)}
		</Show>
	);
}

/**
 * The instructor's team management: the table of teams (or of students, on an
 * individual assignment), the students without a team, and the dialogs for
 * composing teams. Every change goes through an action and reloads the page.
 */
export default function TeamsManager(props: Props): JSX.Element {
	const [dialog, setDialog] = createSignal<DialogState | null>(null);
	const [failure, setFailure] = createSignal<string | undefined>();
	const close = () => setDialog(null);
	const { teamMin, teamMax, params } = props.data;
	const individual = teamMax === 1;

	const teamOf = (username: string): ManagedTeam | undefined =>
		props.data.teams.find((team) =>
			team.members.some((member) => member.username === username),
		);
	const unassigned = createMemo(() =>
		props.data.students.filter((student) => !teamOf(student.username)),
	);
	const teamById = (id: string | undefined) =>
		props.data.teams.find((team) => team.id === id);
	const studentByName = (username: string | undefined) =>
		props.data.students.find((student) => student.username === username);

	/// Calls an action from outside a dialog, showing a refusal above the tables.
	async function removeMember(team: ManagedTeam, student: ManagedStudent) {
		setFailure(undefined);
		const { error } = await actions.assignment.staffRemoveMember({
			...params,
			team: team.id,
			username: student.username,
		});
		if (error) setFailure(errorMessage(error));
		else window.location.reload();
	}

	const teamColumns: ColumnConfig<ManagedTeam>[] = [
		{
			title: m.assignments_col_team(),
			class: "font-medium",
			render: (team) => (
				<>
					{team.name}
					<Show when={team.dueAt}>
						{(due) => (
							<div class="mt-0.5">
								<span class="badge badge-info badge-soft badge-xs whitespace-nowrap font-normal">
									{m.assignments_extended_until({ when: when(due()) })}
								</span>
							</div>
						)}
					</Show>
				</>
			),
		},
		{
			title: m.assignments_col_members(),
			render: (team) => (
				<ul class="flex flex-wrap gap-1">
					<For
						each={team.members}
						fallback={
							<li class="text-sm text-muted">{m.assignments_nobody()}</li>
						}
					>
						{(member) => (
							<li class="badge badge-outline badge-sm gap-1 whitespace-nowrap">
								{member.name}
								<button
									type="button"
									class="btn btn-ghost btn-xs size-5 min-h-0 p-0 text-error"
									aria-label={m.assignments_remove_member({
										name: member.name,
										team: team.name,
									})}
									title={m.assignments_remove_member_title()}
									onClick={() => removeMember(team, member)}
								>
									×
								</button>
							</li>
						)}
					</For>
				</ul>
			),
		},
		{
			title: m.assignments_col_size(),
			class: "px-2",
			headerClass: "px-2",
			render: (team) => (
				<TeamSize
					size={team.members.length}
					pushes={team.pushes}
					exception={team.sizeException}
					min={teamMin}
					max={teamMax}
				/>
			),
		},
		{
			title: m.assignments_col_deliveries(),
			class: "px-2",
			headerClass: "px-2",
			render: (team) => <Deliveries onTime={team.onTime} late={team.late} />,
		},
		{
			title: m.assignments_col_actions(),
			class: "px-2",
			headerClass: "px-2",
			render: (team) => (
				<div class="flex items-center gap-1 whitespace-nowrap">
					<button
						type="button"
						class="btn btn-ghost btn-xs btn-square"
						aria-label={m.assignments_add_student_to_team({ team: team.name })}
						title={m.assignments_add_student_title()}
						onClick={() => setDialog({ kind: "add-member", team: team.id })}
					>
						<svg
							viewBox="0 0 24 24"
							class="size-4"
							fill="none"
							aria-hidden="true"
						>
							<path
								d={ADD_STUDENT_ICON}
								stroke="currentColor"
								stroke-width="1.8"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					</button>
					<RowMenu
						label={m.assignments_more_actions({ team: team.name })}
						items={[
							{
								text: m.assignments_rename(),
								run: () => setDialog({ kind: "rename", team: team.id }),
							},
							{
								text: m.assignments_delete_team(),
								danger: true,
								run: () => setDialog({ kind: "delete-team", team: team.id }),
							},
						]}
					/>
				</div>
			),
		},
	];

	const repositoryColumns: ColumnConfig<ManagedRepository>[] = [
		{
			title: m.assignments_col_student(),
			class: "font-medium",
			render: (row) => (
				<>
					{row.student.name}
					<div class="font-mono text-xs font-normal text-muted">
						@{row.student.username}
					</div>
				</>
			),
		},
		{
			title: m.assignments_col_due(),
			render: (row) => (
				<Show when={row.dueAt} fallback={<span class="text-muted">—</span>}>
					{(due) => (
						<span class="badge badge-info badge-soft badge-sm whitespace-nowrap">
							{m.assignments_extended_until({ when: when(due()) })}
						</span>
					)}
				</Show>
			),
		},
		{
			title: m.assignments_col_deliveries(),
			render: (row) => (
				<Show
					when={row.created}
					fallback={
						<span class="badge badge-warning badge-soft badge-sm">
							{m.assignments_no_repository()}
						</span>
					}
				>
					<Deliveries onTime={row.onTime} late={row.late} />
				</Show>
			),
		},
	];

	const unassignedColumns: ColumnConfig<ManagedStudent>[] = [
		{
			title: m.assignments_col_student(),
			class: "font-medium",
			render: (student) => student.name,
		},
		{
			title: m.assignments_col_username(),
			class: "font-mono text-sm text-muted",
			render: (student) => `@${student.username}`,
		},
		{
			title: "",
			class: "text-right",
			render: (student) => (
				<button
					type="button"
					class="btn btn-xs"
					onClick={() =>
						setDialog({ kind: "assign-student", student: student.username })
					}
				>
					{m.assignments_add_to_team()}
				</button>
			),
		},
	];

	return (
		<div class="flex flex-col gap-10">
			<section
				aria-label={
					individual
						? m.assignments_students_heading()
						: m.assignments_teams_heading()
				}
			>
				<h3 class="page-subheader mb-2">
					{individual
						? m.assignments_students_heading()
						: m.assignments_teams_heading()}
				</h3>
				<FormAlert error={failure()} class="mb-3" />
				<Show
					when={!individual}
					fallback={
						<SearchableTable
							columns={repositoryColumns}
							data={props.data.repositories}
							searchText={(row) =>
								`${row.student.name} ${row.student.username}`
							}
							searchLabel={m.assignments_search_student()}
							pageSize={15}
							label={m.assignments_students_table()}
						/>
					}
				>
					<SearchableTable
						columns={teamColumns}
						data={props.data.teams}
						searchText={(team) =>
							`${team.name} ${team.members.map((s) => `${s.name} ${s.username}`).join(" ")}`
						}
						searchLabel={m.assignments_search_team()}
						pageSize={15}
						label={m.assignments_teams_table()}
					>
						<button
							type="button"
							class="btn btn-primary btn-sm"
							onClick={() => setDialog({ kind: "create-team" })}
						>
							{m.assignments_create_team()}
						</button>
					</SearchableTable>
				</Show>
			</section>

			<Show when={!individual}>
				<section aria-label={m.assignments_unassigned_table()}>
					<h3 class="page-subheader mb-2">
						{m.assignments_unassigned_heading({ count: unassigned().length })}
					</h3>
					<SearchableTable
						columns={unassignedColumns}
						data={unassigned()}
						searchText={(student) => `${student.name} ${student.username}`}
						searchLabel={m.assignments_search_student()}
						pageSize={10}
						label={m.assignments_unassigned_table()}
						empty={<span>{m.assignments_unassigned_empty()}</span>}
					/>
				</section>
			</Show>

			<Show when={dialog()}>
				{(state) => (
					<Dialog
						state={state()}
						close={close}
						open={setDialog}
						data={props.data}
						teamOf={teamOf}
						teamById={teamById}
						studentByName={studentByName}
					/>
				)}
			</Show>
		</div>
	);
}

interface DialogProps {
	state: DialogState;
	close: () => void;
	open: (state: DialogState) => void;
	data: ManagerData;
	teamOf: (username: string) => ManagedTeam | undefined;
	teamById: (id: string | undefined) => ManagedTeam | undefined;
	studentByName: (username: string | undefined) => ManagedStudent | undefined;
}

/// Shell of every dialog: a modal that is open from the moment it mounts, closed by the backdrop or the cancel button.
function Modal(props: {
	title: string;
	close: () => void;
	children: JSX.Element;
	actions?: JSX.Element;
	/// Called with the submit event when the dialog is a form.
	onSubmit?: (event: SubmitEvent) => void;
	wide?: boolean;
}): JSX.Element {
	let dialog: HTMLDialogElement | undefined;
	onMount(() => dialog?.showModal());
	const body = (
		<>
			<h3 class="text-lg font-bold">{props.title}</h3>
			<div class="mt-3 flex flex-col gap-3">{props.children}</div>
			<div class="modal-action">
				<button
					type="button"
					class="btn btn-ghost"
					onClick={() => dialog?.close()}
				>
					{m.assignments_cancel()}
				</button>
				{props.actions}
			</div>
		</>
	);
	const boxClass = `modal-box ${props.wide ? "max-w-2xl" : ""}`;
	return (
		<dialog
			ref={dialog}
			class="modal text-left"
			aria-label={props.title}
			onClose={props.close}
		>
			<Show when={props.onSubmit} fallback={<div class={boxClass}>{body}</div>}>
				<form class={boxClass} noValidate onSubmit={props.onSubmit}>
					{body}
				</form>
			</Show>
			<form method="dialog" class="modal-backdrop">
				<button type="submit">{m.assignments_close_dialog()}</button>
			</form>
		</dialog>
	);
}

/// "3 members", "1 member".
function members(count: number): string {
	return m.assignments_members_count({ count });
}

function Dialog(props: DialogProps): JSX.Element {
	const s = () => props.state;
	const team = () => props.teamById(s().team);
	const student = () => props.studentByName(s().student);
	const [query, setQuery] = createSignal("");
	const [error, setError] = createSignal<string | undefined>();
	const [busy, setBusy] = createSignal(false);
	const { teamMin, teamMax, params } = props.data;

	const found = createMemo(() => {
		const q = query().trim();
		return q ? props.data.students.filter((st) => matches(st, q)) : [];
	});

	/// Runs an action; a refusal stays in the dialog, a success reloads the page.
	async function run(
		call: () => PromiseLike<{ error?: Parameters<typeof errorMessage>[0] }>,
	): Promise<void> {
		setBusy(true);
		setError(undefined);
		const { error: failure } = await call();
		if (failure) {
			setError(errorMessage(failure));
			setBusy(false);
			return;
		}
		window.location.reload();
	}

	const addTo = (target: ManagedTeam, username: string) =>
		run(() =>
			actions.assignment.staffAddMember({
				...params,
				team: target.id,
				username,
			}),
		);

	const createForm = createSchemaForm(assignmentStaffCreate, {
		action: actions.assignment.staffCreateTeam,
		hidden: params,
		id: "create-team",
		fields: {
			name: {
				label: m.assignments_team_name(),
				placeholder: m.assignments_team_name_placeholder(),
			},
		},
		onSuccess: () => window.location.reload(),
	});
	const renameForm = createSchemaForm(assignmentStaffRename, {
		action: actions.assignment.staffRenameTeam,
		hidden: { ...params, team: s().team ?? "" },
		id: "rename-team",
		fields: { name: { label: m.assignments_dialog_rename_label() } },
		onSuccess: () => window.location.reload(),
	});

	return (
		<>
			<Show when={s().kind === "add-member" && team()}>
				{(target) => (
					<Modal
						title={m.assignments_dialog_add_title({ team: target().name })}
						close={props.close}
						wide
					>
						<FormAlert error={error()} />
						<label class="input w-full">
							<input
								type="search"
								placeholder={m.assignments_dialog_add_placeholder()}
								aria-label={m.assignments_search_student()}
								value={query()}
								onInput={(event) => setQuery(event.currentTarget.value)}
							/>
						</label>
						<p class="text-xs text-muted">
							{target().members.length + 1 > teamMax ||
							target().members.length + 1 < teamMin
								? m.assignments_dialog_add_exception({
										members: members(target().members.length),
										min: teamMin,
										max: teamMax,
									})
								: m.assignments_dialog_add_hint({
										members: members(target().members.length),
										min: teamMin,
										max: teamMax,
									})}
						</p>
						<Show when={query().trim() === ""}>
							<p class="text-sm text-muted">
								{m.assignments_dialog_add_type()}
							</p>
						</Show>
						<ul class="divide-y divide-base-content/10 rounded-box border border-base-content/15 empty:hidden">
							<For each={found().slice(0, 6)}>
								{(candidate) => {
									const current = () => props.teamOf(candidate.username);
									return (
										<li class="flex flex-wrap items-center gap-2 px-3 py-2">
											<span class="min-w-0 flex-1">
												<span class="font-medium">{candidate.name}</span>
												<span class="ml-2 font-mono text-xs text-muted">
													@{candidate.username}
												</span>
											</span>
											<Show
												when={current()}
												fallback={
													<span class="text-xs text-muted">
														{m.assignments_dialog_no_team()}
													</span>
												}
											>
												{(from) => (
													<span class="badge badge-warning badge-soft badge-sm">
														{m.assignments_dialog_in_team({
															team: from().name,
														})}
													</span>
												)}
											</Show>
											<Show
												when={current()?.id !== target().id}
												fallback={
													<span class="text-xs text-muted">
														{m.assignments_dialog_here()}
													</span>
												}
											>
												<Show
													when={current()}
													fallback={
														<button
															type="button"
															class="btn btn-primary btn-xs"
															disabled={busy()}
															onClick={() =>
																addTo(target(), candidate.username)
															}
														>
															{m.assignments_dialog_add()}
														</button>
													}
												>
													<button
														type="button"
														class="btn btn-warning btn-outline btn-xs"
														onClick={() =>
															props.open({
																kind: "move-member",
																team: target().id,
																student: candidate.username,
															})
														}
													>
														{m.assignments_dialog_move_here()}
													</button>
												</Show>
											</Show>
										</li>
									);
								}}
							</For>
						</ul>
						<Show when={found().length > 6}>
							<p class="text-xs text-muted">
								{m.assignments_dialog_add_more({ count: found().length - 6 })}
							</p>
						</Show>
						<Show when={query().trim() !== "" && found().length === 0}>
							<p class="text-sm text-muted">
								{m.assignments_dialog_add_none()}
							</p>
						</Show>
					</Modal>
				)}
			</Show>

			<Show when={s().kind === "move-member" && team() && student()}>
				<Modal
					title={m.assignments_dialog_move_title({
						student: student()?.name ?? "",
						team: team()?.name ?? "",
					})}
					close={props.close}
					actions={
						<button
							type="button"
							class="btn btn-warning"
							disabled={busy()}
							onClick={() => {
								const target = team();
								const who = student();
								if (target && who) void addTo(target, who.username);
							}}
						>
							{m.assignments_dialog_move_confirm()}
						</button>
					}
				>
					<FormAlert error={error()} />
					<Show when={props.teamOf(s().student ?? "")}>
						{(from) => (
							<p>
								{m.assignments_dialog_move_text({
									student: student()?.name ?? "",
									from: from().name,
									to: team()?.name ?? "",
								})}
							</p>
						)}
					</Show>
					<ul class="list-disc pl-5 text-sm text-muted">
						<li>{m.assignments_dialog_move_token()}</li>
						<li>{m.assignments_dialog_move_pushes()}</li>
						<li>{m.assignments_dialog_move_new()}</li>
					</ul>
				</Modal>
			</Show>

			<Show when={s().kind === "delete-team" && team()}>
				{(target) => (
					<Modal
						title={m.assignments_dialog_delete_title({ team: target().name })}
						close={props.close}
						actions={
							<button
								type="button"
								class="btn btn-error"
								disabled={busy()}
								onClick={() =>
									run(() =>
										actions.assignment.staffDeleteTeam({
											...params,
											team: target().id,
										}),
									)
								}
							>
								{m.assignments_dialog_delete_confirm({
									count: target().pushes,
								})}
							</button>
						}
					>
						<FormAlert error={error()} />
						<p>
							{m.assignments_dialog_delete_text({ count: target().pushes })}
						</p>
						<Show
							when={target().members.length > 0}
							fallback={
								<p class="text-sm text-muted">
									{m.assignments_dialog_delete_empty()}
								</p>
							}
						>
							<p class="text-sm text-muted">
								{m.assignments_dialog_delete_left({
									names: target()
										.members.map((member) => member.name)
										.join(", "),
								})}
							</p>
						</Show>
					</Modal>
				)}
			</Show>

			<Show when={s().kind === "rename" && team()}>
				{(target) => (
					<Modal
						title={m.assignments_dialog_rename_title({ team: target().name })}
						close={props.close}
						onSubmit={renameForm.submit}
						actions={
							<button
								type="submit"
								class="btn btn-primary"
								disabled={renameForm.busy()}
							>
								{m.assignments_rename()}
							</button>
						}
					>
						<FormAlert error={renameForm.error()} />
						<Field
							{...renameForm.field("name")}
							control={{ value: target().name, autofocus: true }}
						/>
					</Modal>
				)}
			</Show>

			<Show when={s().kind === "create-team"}>
				<Modal
					title={m.assignments_dialog_create_title()}
					close={props.close}
					onSubmit={createForm.submit}
					actions={
						<button
							type="submit"
							class="btn btn-primary"
							disabled={createForm.busy()}
						>
							{m.assignments_create_team()}
						</button>
					}
				>
					<FormAlert error={createForm.error()} />
					<Field {...createForm.field("name")} control={{ autofocus: true }} />
					<p class="text-sm text-muted">{m.assignments_dialog_create_hint()}</p>
				</Modal>
			</Show>

			<Show when={s().kind === "assign-student" && student()}>
				{(who) => (
					<Modal
						title={m.assignments_dialog_assign_title({ student: who().name })}
						close={props.close}
						wide
					>
						<FormAlert error={error()} />
						<label class="input w-full">
							<input
								type="search"
								placeholder={m.assignments_search_team_only()}
								aria-label={m.assignments_search_team_only()}
								value={query()}
								onInput={(event) => setQuery(event.currentTarget.value)}
							/>
						</label>
						<ul class="max-h-72 divide-y divide-base-content/10 overflow-y-auto rounded-box border border-base-content/15">
							<For
								each={props.data.teams.filter((t) =>
									fold(t.name).includes(fold(query().trim())),
								)}
							>
								{(candidate) => (
									<li class="flex items-center gap-2 px-3 py-2">
										<span class="flex-1">
											<span class="font-medium">{candidate.name}</span>
											<span class="ml-2 text-xs text-muted">
												{m.assignments_dialog_assign_count({
													count: candidate.members.length,
												})}
											</span>
										</span>
										<button
											type="button"
											class="btn btn-primary btn-xs"
											disabled={busy()}
											onClick={() => addTo(candidate, who().username)}
										>
											{m.assignments_dialog_add()}
										</button>
									</li>
								)}
							</For>
						</ul>
					</Modal>
				)}
			</Show>
		</>
	);
}
