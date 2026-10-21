import { actions } from "astro:actions";
import { createSignal, type JSX, Show } from "solid-js";
import { createSchemaForm } from "@/components/form/create-schema-form";
import Field from "@/components/form/Field";
import FormAlert from "@/components/form/FormAlert";
import { regradeRequestForm } from "@/core/schemas";
import { errorMessage } from "@/forms/field-errors";
import { m } from "@/i18n";

/// What the student's exam page knows about the regrade of one question's answer.
export interface QuestionRegrade {
	/// The `publicId` of the counting submission.
	submission: string;
	/// Whether the student may open a request now.
	canRequest: boolean;
	/// The request already made for the answer, if any.
	request: {
		publicId: string;
		status: "OPEN" | "ACCEPTED" | "REJECTED";
		message: string;
		reply: string | null;
	} | null;
}

export interface RegradeControlsProps {
	/// The course's URL segments and the exam slug, as the regrade actions take them.
	discipline: string;
	course: string;
	exam: string;
	regrade: QuestionRegrade;
}

const BADGES = {
	OPEN: ["badge-warning", () => m.grades_regrade_requested()],
	ACCEPTED: ["badge-success", () => m.grades_regrade_accepted()],
	REJECTED: ["badge-error", () => m.grades_regrade_rejected()],
} as const;

/**
 * What a student sees and can do about the regrade of one answer.
 *
 * With no request and the window open it offers "Request regrade", which
 * opens a dialog for the justification. An existing request shows its badge,
 * justification and the instructor's reply, and an open one can be withdrawn.
 */
export default function RegradeControls(
	props: RegradeControlsProps,
): JSX.Element {
	const [failure, setFailure] = createSignal<string | undefined>();
	const [busy, setBusy] = createSignal(false);
	const [dialogOpen, setDialogOpen] = createSignal(false);
	const titleId = `regrade-title-${props.regrade.submission}`;
	let dialog: HTMLDialogElement | undefined;

	async function withdraw(request: string): Promise<void> {
		setBusy(true);
		setFailure(undefined);
		const { error } = await actions.regrade.withdraw({
			discipline: props.discipline,
			course: props.course,
			exam: props.exam,
			request,
		});
		if (error) {
			setFailure(errorMessage(error));
			setBusy(false);
			return;
		}
		window.location.reload();
	}

	return (
		<div class="mt-3 flex flex-col gap-2">
			<FormAlert error={failure()} />
			<Show when={props.regrade.request}>
				{(request) => (
					<div class="rounded-box bg-base-200/50 p-3 text-sm">
						<span class={`badge badge-sm ${BADGES[request().status][0]}`}>
							{BADGES[request().status][1]()}
						</span>
						<p class="mt-2 whitespace-pre-wrap">{request().message}</p>
						<Show when={request().reply}>
							{(reply) => (
								<p class="mt-2 whitespace-pre-wrap">
									<span class="font-medium">
										{m.grades_regrade_instructor_reply()}
									</span>{" "}
									{reply()}
								</p>
							)}
						</Show>
						<Show when={request().status === "OPEN"}>
							<button
								type="button"
								class="btn btn-ghost btn-sm mt-2"
								disabled={busy()}
								onClick={() => withdraw(request().publicId)}
							>
								{m.grades_regrade_withdraw()}
							</button>
						</Show>
					</div>
				)}
			</Show>

			<Show when={props.regrade.canRequest}>
				<div>
					<button
						type="button"
						class="btn btn-outline btn-sm"
						onClick={() => {
							setDialogOpen(true);
							dialog?.showModal();
						}}
					>
						{m.grades_regrade_request()}
					</button>
				</div>
				<dialog
					ref={dialog}
					class="modal"
					aria-labelledby={titleId}
					onClose={() => setDialogOpen(false)}
				>
					<div class="modal-box">
						<h3 id={titleId} class="text-lg font-bold">
							{m.grades_regrade_dialog_title()}
						</h3>
						<Show when={dialogOpen()}>
							<RequestForm
								{...props}
								onCancel={() => dialog?.close()}
								submission={props.regrade.submission}
							/>
						</Show>
					</div>
					<form method="dialog" class="modal-backdrop">
						<button type="submit">{m.grades_close_backdrop()}</button>
					</form>
				</dialog>
			</Show>
		</div>
	);
}

/// The dialog's form: the justification, and the buttons that send it or cancel.
function RequestForm(
	props: Pick<RegradeControlsProps, "discipline" | "course" | "exam"> & {
		submission: string;
		onCancel: () => void;
	},
): JSX.Element {
	const form = createSchemaForm(regradeRequestForm, {
		id: `regrade-${props.submission}`,
		action: actions.regrade.request,
		hidden: {
			discipline: props.discipline,
			course: props.course,
			exam: props.exam,
			submission: props.submission,
		},
		onSuccess: () => window.location.reload(),
	});

	return (
		<form noValidate class="mt-4 flex flex-col gap-3" onSubmit={form.submit}>
			<Field {...form.field("message")} />
			<FormAlert error={form.error()} />
			<div class="modal-action">
				<button
					type="button"
					class="btn btn-ghost"
					disabled={form.busy()}
					onClick={props.onCancel}
				>
					{m.grades_regrade_cancel()}
				</button>
				<button type="submit" class="btn btn-primary" disabled={form.busy()}>
					{m.grades_regrade_send()}
				</button>
			</div>
		</form>
	);
}
