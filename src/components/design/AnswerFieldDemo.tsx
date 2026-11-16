import type { JSX } from "solid-js";
import {
	AnswerField,
	type AnswerFieldProps,
} from "@/components/exam/AnswerField";

/// What `AnswerFieldDemo` shows of `AnswerField`: the answer frozen, or reviewed with its marks.
type Props = Pick<AnswerFieldProps, "question" | "payload" | "review">;

/** An answer that cannot be edited, with or without the marks of a review, for the design catalogue. */
export default function AnswerFieldDemo(props: Props): JSX.Element {
	return (
		<AnswerField
			question={props.question}
			payload={props.payload}
			review={props.review}
			readonly
			onChange={() => {}}
		/>
	);
}
