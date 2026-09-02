import { actions } from "astro:actions";
import type { JSX } from "solid-js";
import Badge from "@/components/ui/Badge";
import Table, { type ColumnConfig } from "@/components/ui/Table";

export interface UserRow {
	id: number;
	name: string;
	username: string;
	email: string;
	role: "ADMIN" | "INSTRUCTOR" | "STUDENT";
	createdAt: Date;
}

interface Props {
	users: UserRow[];
}

const ROLE_BADGE = {
	ADMIN: "warning",
	INSTRUCTOR: "primary",
	STUDENT: undefined,
} as const;

function formatDate(date: Date): string {
	return date.toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

export default function UsersTable(props: Props): JSX.Element {
	const columns: ColumnConfig<UserRow>[] = [
		{ title: "Name", class: "font-medium", render: (row) => row.name },
		{
			title: "Username",
			class: "font-mono text-sm text-base-content/60",
			render: (row) => `@${row.username}`,
		},
		{
			title: "Email",
			class: "text-base-content/60",
			render: (row) => row.email,
		},
		{
			title: "Role",
			render: (row) => {
				const variant = ROLE_BADGE[row.role];
				return variant ? (
					<Badge variant={variant} size="sm">
						{row.role.toLowerCase()}
					</Badge>
				) : (
					<Badge style="outline" size="sm">
						{row.role.toLowerCase()}
					</Badge>
				);
			},
		},
		{
			title: "Joined",
			class: "text-base-content/60",
			render: (row) => formatDate(row.createdAt),
		},
		{
			title: "Actions",
			class: "text-right",
			headerClass: "text-right",
			render: (row) => (
				<>
					<button
						type="button"
						class="btn btn-square btn-error btn-sm text-white"
						aria-label={`Force logout ${row.name}`}
						title="Force logout"
						data-open-dialog={`force-logout-${row.id}`}
					>
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
							<title>Force logout</title>
							<path
								d="M15 4H8a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h7M18.5 12H10m8.5 0-3-3m3 3-3 3"
								stroke="currentColor"
								stroke-width="1.6"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					</button>

					<dialog id={`force-logout-${row.id}`} class="modal">
						<div class="modal-box">
							<form method="dialog">
								<button
									class="btn btn-circle btn-ghost btn-sm absolute right-2 top-2"
									type="button"
								>
									✕
								</button>
							</form>
							<h3 class="text-lg font-bold">Force logout {row.name}?</h3>
							<p class="mt-2 text-sm text-base-content/70">
								Every active session ends immediately; the account itself is not
								disabled.
							</p>
							<form
								method="post"
								action={actions.admin.forceLogout}
								class="modal-action"
							>
								<input type="hidden" name="userId" value={row.id} />
								<button type="submit" class="btn btn-error">
									Log out
								</button>
							</form>
						</div>
						<form method="dialog" class="modal-backdrop">
							<button type="submit">close</button>
						</form>
					</dialog>
				</>
			),
		},
	];

	return <Table columns={columns} data={props.users} class="mt-8" />;
}
