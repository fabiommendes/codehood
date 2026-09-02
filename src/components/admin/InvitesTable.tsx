import { actions } from "astro:actions";
import type { JSX } from "solid-js";
import Table, { type ColumnConfig } from "@/components/ui/Table";

export interface InviteRow {
	id: number;
	email: string;
	createdByName: string;
	createdAt: Date;
	expiresAt: Date;
	maxUses: number | null;
	redemptions: number;
}

interface Props {
	invites: InviteRow[];
}

function formatDate(date: Date): string {
	return date.toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

export default function InvitesTable(props: Props): JSX.Element {
	const columns: ColumnConfig<InviteRow>[] = [
		{ title: "Email", render: (row) => row.email },
		{
			title: "Created by",
			class: "text-base-content/60",
			render: (row) => row.createdByName,
		},
		{
			title: "Created",
			class: "text-base-content/60",
			render: (row) => formatDate(row.createdAt),
		},
		{
			title: "Expires",
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
			title: "Uses",
			class: "text-base-content/60",
			render: (row) => `${row.redemptions} / ${row.maxUses ?? "—"}`,
		},
		{
			title: "Actions",
			class: "text-right",
			headerClass: "text-right",
			render: (row) => (
				<>
					<button
						type="button"
						class="btn btn-outline btn-error btn-sm"
						data-open-dialog={`revoke-invite-${row.id}`}
					>
						Revoke
					</button>

					<dialog id={`revoke-invite-${row.id}`} class="modal">
						<div class="modal-box">
							<form method="dialog">
								<button
									class="btn btn-circle btn-ghost btn-sm absolute right-2 top-2"
									type="button"
								>
									✕
								</button>
							</form>
							<h3 class="text-lg font-bold">
								Revoke the invite for {row.email}?
							</h3>
							<p class="mt-2 text-sm text-base-content/70">
								Its link stops working immediately. To invite them again, issue
								a new one.
							</p>
							<form
								method="post"
								action={actions.admin.revokeInvite}
								class="modal-action"
							>
								<input type="hidden" name="id" value={row.id} />
								<button type="submit" class="btn btn-error">
									Revoke
								</button>
							</form>
						</div>
						<form method="dialog" class="modal-backdrop">
							<button type="button">close</button>
						</form>
					</dialog>
				</>
			),
		},
	];

	return <Table columns={columns} data={props.invites} class="mt-4" />;
}
