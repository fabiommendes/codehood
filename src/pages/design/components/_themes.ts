/// The theme pages of the component catalogue, in tab order; `href` is also the key.
export const themes = [
	{
		href: "/design/components/ui",
		label: "Base UI",
		description:
			"Empty states, form fields and their errors, password confirmation, file lists, CSV download and the glass wall.",
	},
	{
		href: "/design/components/course",
		label: "Course",
		description:
			"Page headers, course tiles and the rows that lead to an action.",
	},
	{
		href: "/design/components/schedule",
		label: "Schedule and attendance",
		description:
			"Check-in, the instructor's roll call, its projection and the button that opens one.",
	},
	{
		href: "/design/components/exams",
		label: "Exams",
		description:
			"Exam rows, question labels, exceptions, the results table and grade release.",
	},
	{
		href: "/design/components/grading",
		label: "Grading and regrades",
		description:
			"Applied rubric items, regrade requests, question statistics and answer distributions.",
	},
	{
		href: "/design/components/reports",
		label: "Reports",
		description:
			"The report dialog, the triage queue and the filters of the queue.",
	},
] as const;
