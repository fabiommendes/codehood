import { actions } from "astro:actions";
import { createSignal, type JSX } from "solid-js";
import { createSchemaForm } from "@/components/form/create-schema-form";
import Field from "@/components/form/Field";
import FormAlert from "@/components/form/FormAlert";
import { regradeAcceptForm, regradeReject } from "@/core/schemas";
import { errorMessage } from "@/forms/field-errors";
import { m } from "@/i18n";

export interface RegradeResolveProps {
	/// The course's URL segments and the exam slug, as the regrade actions take them.
	discipline: string;
	course: string;
	exam: string;
	/// The `publicId` of the open request.
	request: string;
}

/**
 * The instructor's form on an open regrade request: a new score and a reply, then "Accept" or "Reject".
 *
 * Accepting needs both fields; rejecting only the reply. Either one reloads
 * the page so the request moves under the resolved ones. A refusal, from the
 * form's own checks or from the server, shows inside the card.
 */
export default function RegradeResolve(
	props: RegradeResolveProps,
): JSX.Element {
	const target = {
		discipline: props.discipline,
		course: props.course,
		exam: props.exam,
		request: props.request,
	};
	const [rejectError, setRejectError] = createSignal<string | undefined>();
	const [rejecting, setRejecting] = createSignal(false);
	const form = createSchemaForm(regradeAcceptForm, {
		id: `regrade-${props.request}`,
		action: actions.regrade.accept,
		hidden: target,
		onSuccess: () => window.location.reload(),
	});

	async function reject(button: HTMLButtonElement): Promise<void> {
		const data = new FormData(button.form as HTMLFormElement);
		const parsed = regradeReject.safeParse({ reply: data.get("reply") ?? "" });
		if (!parsed.success) {
			setRejectError(parsed.error.issues[0]?.message);
			return;
		}
		setRejecting(true);
		setRejectError(undefined);
		const { error } = await actions.regrade.reject({
			...target,
			reply: parsed.data.reply,
		});
		if (error) {
			setRejectError(errorMessage(error));
			setRejecting(false);
			return;
		}
		window.location.reload();
	}

	return (
		<form noValidate class="mt-4 flex flex-col gap-3" onSubmit={form.submit}>
			<FormAlert error={rejectError() ?? form.error()} />
			<Field
				{...form.field("score")}
				control={{ inputmode: "numeric", autocomplete: "off" }}
			/>
			<Field {...form.field("reply")} />
			<div class="flex gap-2">
				<button
					type="submit"
					class="btn btn-primary"
					disabled={form.busy() || rejecting()}
				>
					{m.grades_regrade_accept()}
				</button>
				<button
					type="button"
					class="btn btn-outline"
					disabled={form.busy() || rejecting()}
					onClick={(event) => reject(event.currentTarget)}
				>
					{m.grades_regrade_reject()}
				</button>
			</div>
		</form>
	);
}
