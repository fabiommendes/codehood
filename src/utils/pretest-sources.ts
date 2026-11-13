import { type CodeQuestion, fullRubric } from "mdq";

/// A test source as the browser runner takes it (`TestRun.tests`).
export interface PretestSource {
	format: string;
	text: string;
}

/**
 * The test sources of a resolved code question that the browser may run as
 * pretests: those with at least one annotated region and every region public.
 *
 * The public form hides the text outside the public regions, and a runner
 * needs the whole source (imports and module header included). So the host
 * sends the whole text, and only of a source that hides nothing else: a source
 * with a hidden region, or with no annotation at all (an implicit hidden item),
 * stays out. The worker runs every source again on submission.
 *
 * @throws {UnresolvedTestSource} A test source has no text.
 */
export function pretestSources(question: CodeQuestion): PretestSource[] {
	const items = fullRubric(question).filter((item) => item.binding === "tests");
	return (question.tests ?? []).flatMap((source, index) => {
		const own = items.filter((item) => item.source === index);
		const allPublic = own.length > 0 && own.every((item) => item.public);
		return allPublic && source.text !== undefined
			? [{ format: source.format, text: source.text }]
			: [];
	});
}
