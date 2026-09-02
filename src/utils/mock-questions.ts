// Fixture data for the /questions mock (src/pages/[discipline]/[course]/questions/*).
// QuestionService doesn't exist yet (dev/specs/to-do/questions.md) — this stands in
// for it so the list and detail pages share one slug-addressable source, the same
// role a real findMany/findOne pair would play once the CLI can push content.

export type QuestionType =
	| "MULTIPLE_CHOICE"
	| "MULTIPLE_SELECTION"
	| "TRUE_FALSE"
	| "ESSAY";
export type QuestionStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export interface MockQuestion {
	slug: string;
	title: string;
	type: QuestionType;
	status: QuestionStatus;
	tags: string[];
	/** null when the viewing instructor authored it themselves. */
	sharedBy: { group: string; author: string } | null;
	updatedAt: string;
	stem: string;
}

export const questionTypeLabels: Record<QuestionType, string> = {
	MULTIPLE_CHOICE: "Multiple choice",
	MULTIPLE_SELECTION: "Multiple selection",
	TRUE_FALSE: "True / false",
	ESSAY: "Essay",
};

export const mockQuestions: MockQuestion[] = [
	{
		slug: "recursion-basics",
		title: "Recursion basics",
		type: "MULTIPLE_CHOICE",
		status: "PUBLISHED",
		tags: ["recursion", "functions"],
		sharedBy: null,
		updatedAt: "Mar 2",
		stem: "Which of the following is required for a recursive function to terminate?",
	},
	{
		slug: "big-o-warmup",
		title: "Big-O warm-up",
		type: "MULTIPLE_SELECTION",
		status: "PUBLISHED",
		tags: ["complexity"],
		sharedBy: null,
		updatedAt: "Feb 26",
		stem: "Select every statement below that correctly describes O(n log n) growth.",
	},
	{
		slug: "linked-list-invariants",
		title: "Linked list invariants",
		type: "ESSAY",
		status: "DRAFT",
		tags: ["data-structures"],
		sharedBy: null,
		updatedAt: "Mar 12",
		stem: "Describe the invariant your `insert` implementation must preserve, and show where it could break.",
	},
	{
		slug: "loop-invariants",
		title: "Loop invariants",
		type: "TRUE_FALSE",
		status: "PUBLISHED",
		tags: ["loops"],
		sharedBy: { group: "CS101 Core Team", author: "grace" },
		updatedAt: "Feb 20",
		stem: "True or false: a loop invariant must hold only after the loop terminates.",
	},
	{
		slug: "recursion-vs-iteration",
		title: "Recursion vs. iteration",
		type: "ESSAY",
		status: "PUBLISHED",
		tags: ["recursion", "style"],
		sharedBy: { group: "CS101 Core Team", author: "alan" },
		updatedAt: "Feb 18",
		stem: "Rewrite the given recursive function iteratively, and explain the tradeoff you made.",
	},
	{
		slug: "pointer-arithmetic-pitfalls",
		title: "Pointer arithmetic pitfalls",
		type: "MULTIPLE_CHOICE",
		status: "ARCHIVED",
		tags: ["pointers", "c"],
		sharedBy: null,
		updatedAt: "Jan 9",
		stem: "Which expression below invokes undefined behavior?",
	},
];

export function statusBadgeClass(status: QuestionStatus): string {
	switch (status) {
		case "PUBLISHED":
			return "badge-success";
		case "DRAFT":
			return "badge-outline";
		case "ARCHIVED":
			return "badge-neutral";
	}
}
