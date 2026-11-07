/// The question the rubric grading view works on, as its actions take it.
export interface GradingTarget {
	/// The course's URL segments.
	discipline: string;
	course: string;
	/// The exam's slug.
	exam: string;
	/// The question's slug.
	question: string;
}
