import { actions } from "astro:actions";
import type { JSX } from "solid-js";
import Table, { type ColumnConfig } from "@/components/ui/Table";
import type { Invite } from "@/db";
import { locale, m } from "@/i18n";

interface Props {
	invites: Invite[];
}

function formatDate(date: Date): string {
	return date.toLocaleDateString(locale, {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

export default function InvitesTable(props: Props): JSX.Element {
	const columns: ColumnConfig<Invite>[] = [
		{ title: m.admin_col_email(), render: (row) => row.email },
		{
			title: m.admin_col_created_by(),
			class: "text-base-content/60",
			render: (row) => row.createdBy.name,
		},
		{
			title: m.admin_col_created(),
			class: "text-base-content/60",
			render: (row) => formatDate(row.createdAt),
		},
		{
			title: m.admin_col_expires(),
			render: (row) => {
				const expired = row.expiresAt < new Date();
				return (
					<span class={expired ? "text-error" : "text-base-content/60"}>
						{formatDate(row.expiresAt)}
					</span>
				);
			},
		},
		{
			title: m.admin_col_uses(),
			class: "text-base-content/60",
			render: (row) => `${row.redemptions} / ${row.maxUses ?? "—"}`,
		},
		{
			title: m.admin_col_actions(),
			class: "text-right",
			headerClass: "text-right",
			render: (row) => (
				<>
					<button
						type="button"
						class="btn btn-outline btn-error btn-sm"
						data-open-dialog={`revoke-invite-${row.publicId}`}
					>
						{m.admin_invite_revoke()}
					</button>

					<dialog id={`revoke-invite-${row.publicId}`} class="modal">
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
								{m.admin_invite_revoke_title({ email: row.email ?? "" })}
							</h3>
							<p class="mt-2 text-sm text-base-content/70">
								{m.admin_invite_revoke_text()}
							</p>
							<form
								method="post"
								action={actions.admin.revokeInvite}
								class="modal-action"
							>
								<input type="hidden" name="publicId" value={row.publicId} />
								<button type="submit" class="btn btn-error">
									{m.admin_invite_revoke()}
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

	return <Table columns={columns} data={props.invites} class="mt-4" />;
}
