import { actions } from "astro:actions";
import { type JSX, Show } from "solid-js";
import Field from "@/components/form/Field";
import FormAlert from "@/components/form/FormAlert";
import Badge from "@/components/ui/Badge";
import Table, { type ColumnConfig } from "@/components/ui/Table";
import type { passwordReset } from "@/core/schemas";
import type { User } from "@/db";
import type { FormState } from "@/forms/form-state";
import { locale, m } from "@/i18n";

interface Props {
	users: User[];
	/// State of the password reset form, as read from the action result of the page.
	resetForm: FormState<typeof passwordReset>;
	/// The username whose reset failed, so only that row shows the errors.
	failedUsername?: string;
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
	/// The new password field of `user`'s reset dialog, with errors only when that reset failed.
	const resetField = (user: User) => {
		const failed = props.failedUsername === user.username;
		return {
			...props.resetForm.field("newPassword"),
			id: `reset-password-${user.username}-newPassword`,
			errors: failed ? props.resetForm.field("newPassword").errors : [],
		};
	};

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
						class="btn btn-square btn-ghost btn-sm"
						aria-label={m.admin_reset_password_user({ name: user.name })}
						title={m.admin_reset_password()}
						data-open-dialog={`reset-password-${user.username}`}
					>
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
							<title>{m.admin_reset_password()}</title>
							<path
								d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Zm6 4v2"
								stroke="currentColor"
								stroke-width="1.6"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					</button>

					<dialog
						id={`reset-password-${user.username}`}
						class="modal text-left"
						data-reopen={
							props.failedUsername === user.username ? "" : undefined
						}
					>
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
								{m.admin_reset_password_title({ name: user.name })}
							</h3>
							<p class="mt-2 text-sm text-base-content/70">
								{m.admin_reset_password_text()}
							</p>
							<form
								method="post"
								action={actions.admin.resetPassword}
								class="mt-4 flex flex-col gap-4"
							>
								<input type="hidden" name="username" value={user.username} />
								<Show when={props.failedUsername === user.username}>
									<FormAlert error={props.resetForm.error} />
								</Show>
								<Field {...resetField(user)} />
								<div class="modal-action">
									<button type="submit" class="btn btn-primary">
										{m.admin_reset_password_submit()}
									</button>
								</div>
							</form>
						</div>
						<form method="dialog" class="modal-backdrop">
							<button type="submit">{m.admin_close_backdrop()}</button>
						</form>
					</dialog>

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
