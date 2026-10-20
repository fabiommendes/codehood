import { actions } from "astro:actions";
import type { JSX } from "solid-js";
import Badge from "@/components/ui/Badge";
import Table, { type ColumnConfig } from "@/components/ui/Table";
import type { User } from "@/db";
import { locale, m } from "@/i18n";

interface Props {
	users: User[];
}

/// Display names of the roles.
const ROLE_LABEL = {
	ADMIN: m.admin_role_admin,
	INSTRUCTOR: m.admin_role_instructor,
	STUDENT: m.admin_role_student,
} as const;

const ROLE_BADGE = {
	ADMIN: "warning",
	INSTRUCTOR: "primary",
	STUDENT: undefined,
} as const;

function formatDate(date: Date): string {
	return date.toLocaleDateString(locale, {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

export default function UsersTable(props: Props): JSX.Element {
	const columns: ColumnConfig<User>[] = [
		{
			title: m.admin_col_name(),
			class: "font-medium",
			render: (user) => user.name,
		},
		{
			title: m.admin_col_username(),
			class: "font-mono text-sm text-base-content/60",
			render: (user) => `@${user.username}`,
		},
		{
			title: m.admin_col_email(),
			class: "text-base-content/60",
			render: (user) => user.email,
		},
		{
			title: m.admin_col_role(),
			render: (user) => {
				const variant = ROLE_BADGE[user.role];
				return variant ? (
					<Badge variant={variant} size="sm">
						{ROLE_LABEL[user.role]()}
					</Badge>
				) : (
					<Badge style="outline" size="sm">
						{ROLE_LABEL[user.role]()}
					</Badge>
				);
			},
		},
		{
			title: m.admin_col_joined(),
			class: "text-base-content/60",
			render: (user) => formatDate(user.createdAt),
		},
		{
			title: m.admin_col_actions(),
			class: "text-right",
			headerClass: "text-right",
			render: (user) => (
				<>
					<button
						type="button"
						class="btn btn-square btn-error btn-sm text-white"
						aria-label={m.admin_force_logout_user({ name: user.name })}
						title={m.admin_force_logout()}
						data-open-dialog={`force-logout-${user.username}`}
					>
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
							<title>{m.admin_force_logout()}</title>
							<path
								d="M15 4H8a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h7M18.5 12H10m8.5 0-3-3m3 3-3 3"
								stroke="currentColor"
								stroke-width="1.6"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					</button>

					<dialog id={`force-logout-${user.username}`} class="modal">
						<div class="modal-box">
							<form method="dialog">
								<button
									class="btn btn-circle btn-ghost btn-sm absolute right-2 top-2"
									type="submit"
									aria-label={m.admin_close()}
								>
									✕
								</button>
							</form>
							<h3 class="text-lg font-bold">
								{m.admin_force_logout_title({ name: user.name })}
							</h3>
							<p class="mt-2 text-sm text-base-content/70">
								{m.admin_force_logout_text()}
							</p>
							<form
								method="post"
								action={actions.admin.forceLogout}
								class="modal-action"
							>
								<input type="hidden" name="username" value={user.username} />
								<button type="submit" class="btn btn-error">
									{m.admin_force_logout_submit()}
								</button>
							</form>
						</div>
						<form method="dialog" class="modal-backdrop">
							<button type="submit">{m.admin_close_backdrop()}</button>
						</form>
					</dialog>
				</>
			),
		},
	];

	return <Table columns={columns} data={props.users} class="mt-8" />;
}
