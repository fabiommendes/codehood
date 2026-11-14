import { type CodeQuestion, fullRubric } from "mdq";
import { elmModule } from "@/components/runner/test-report";
import { ElmExamplesError, elmExamplesModule } from "@/services/elm-examples";

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
 * An examples block of an Elm question (an `elm` source with no `module`
 * header) is sent as its generated module with the public cases only: the raw
 * block and the names of the private cases never leave the server.
 *
 * @throws {UnresolvedTestSource} A test source has no text.
 */
export function pretestSources(question: CodeQuestion): PretestSource[] {
	const items = fullRubric(question).filter((item) => item.binding === "tests");
	return (question.tests ?? []).flatMap((source, index) => {
		if (
			question.language === "elm" &&
			source.format === "elm" &&
			source.origin === undefined &&
			source.text !== undefined &&
			elmModule(source.text) === null
		) {
			if (question.file === undefined) return [];
			const text = examplesModule(source.text, index, question.file);
			return text === null ? [] : [{ format: "elm", text }];
		}
		const own = items.filter((item) => item.source === index);
		const allPublic = own.length > 0 && own.every((item) => item.public);
		return allPublic && source.text !== undefined
			? [{ format: source.format, text: source.text }]
			: [];
	});
}

/// The public module of an examples block, or null when it has no public case or is invalid.
function examplesModule(
	text: string,
	index: number,
	answerFile: string,
): string | null {
	try {
		return elmExamplesModule(text, { index, answerFile, publicOnly: true });
	} catch (error) {
		if (error instanceof ElmExamplesError) return null;
		throw error;
	}
}
