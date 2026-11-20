import { type Href, urls } from "@/urls";

/// A theme page of the component catalogue.
interface Theme {
	href: Href;
	label: string;
	description: string;
}

/// The theme pages of the component catalogue, in tab order; `href` is also the key.
export const themes: readonly Theme[] = [
	{
		href: urls.design.components.ui(),
		label: "Base UI",
		description:
			"Empty states, form fields and their errors, password confirmation, file lists, CSV download and the glass wall.",
	},
	{
		href: urls.design.components.course(),
		label: "Course",
		description:
			"Page headers, course tiles and the rows that lead to an action.",
	},
	{
		href: urls.design.components.schedule(),
		label: "Schedule and attendance",
		description:
			"Check-in, the instructor's roll call, its projection and the button that opens one.",
	},
	{
		href: urls.design.components.exams(),
		label: "Exams",
		description:
			"Exam rows, question labels, exceptions, the results table and grade release.",
	},
	{
		href: urls.design.components.grading(),
		label: "Grading and regrades",
		description:
			"Applied rubric items, regrade requests, question statistics and answer distributions.",
	},
	{
		href: urls.design.components.reports(),
		label: "Reports",
		description:
			"The report dialog, the triage queue and the filters of the queue.",
	},
];
