import { createSignal, type JSX } from "solid-js";
import { m } from "@/i18n";
import AdjustmentDialog from "./AdjustmentDialog";

interface Props {
	/// The course's URL segments and the exam slug, as the adjustment action takes them.
	discipline: string;
	course: string;
	exam: string;
}

/**
 * The "Adjust students" button of the adjustments page and the dialog that asks for the usernames and the adjustment.
 */
export default function AdjustStudents(props: Props): JSX.Element {
	const [open, setOpen] = createSignal(false);
	return (
		<>
			<button
				type="button"
				class="btn btn-outline btn-sm"
				onClick={() => setOpen(true)}
			>
				{m.grades_adjustment_adjust_students()}
			</button>
			<AdjustmentDialog
				id="adjust-students"
				open={open()}
				onClose={() => setOpen(false)}
				discipline={props.discipline}
				course={props.course}
				exam={props.exam}
				kind="bonus"
				title={m.grades_adjustment_dialog_title()}
				submitLabel={m.grades_adjustment_submit()}
			/>
		</>
	);
}
