/// The download routes of question, exam and report attachments, under `/api`.

import type { Href } from "./routes";

/// `/api/course/<discipline>/<course>/exam/<exam>`, where `courseSegment` is `<discipline>/<course>`.
function examApi(courseSegment: string, exam: string): string {
	return `/api/course/${courseSegment}/exam/${encodeURIComponent(exam)}`;
}

/** The download URL of the attachment `name` of an exam. */
export function examAttachmentUrl(
	courseSegment: string,
	exam: string,
	name: string,
): Href {
	return `${examApi(courseSegment, exam)}/attachment/${encodeURIComponent(name)}` as Href;
}

/** The download URL of the attachment `name` of a question, at the version the exam pins. */
export function examQuestionAttachmentUrl(
	courseSegment: string,
	exam: string,
	question: string,
	name: string,
): Href {
	return `${examApi(courseSegment, exam)}/question/${encodeURIComponent(question)}/attachment/${encodeURIComponent(name)}` as Href;
}

/** The download URL of the attachment `name` of a question by public id, at a version label or the latest. */
export function questionAttachmentUrl(
	publicId: string,
	name: string,
	version?: string,
): Href {
	const query = version ? `?version=${encodeURIComponent(version)}` : "";
	return `/api/question/${encodeURIComponent(publicId)}/attachment/${encodeURIComponent(name)}${query}` as Href;
}

/** The authenticated download URL of the file `name` an upload answer cites, by the public id of the submission. */
export function examSubmissionFileUrl(
	courseSegment: string,
	exam: string,
	submission: string,
	name: string,
): Href {
	return `${examApi(courseSegment, exam)}/submission/${encodeURIComponent(submission)}/file/${encodeURIComponent(name)}` as Href;
}

/** The URL a file is sent to for an upload question of the author's attempt, and which answers the question's files. */
export function examQuestionFilesUrl(
	courseSegment: string,
	exam: string,
	question: string,
): Href {
	return `${examApi(courseSegment, exam)}/question/${encodeURIComponent(question)}/file` as Href;
}

/** The URL that removes the file `name` of an upload question of the author's attempt. */
export function examQuestionFileUrl(
	courseSegment: string,
	exam: string,
	question: string,
	name: string,
): Href {
	return `${examQuestionFilesUrl(courseSegment, exam, question)}/${encodeURIComponent(name)}` as Href;
}

/** The download URL of the attachment `filename` of a report. */
export function reportAttachmentUrl(publicId: string, filename: string): Href {
	return `/api/report/${encodeURIComponent(publicId)}/attachment/${encodeURIComponent(filename)}` as Href;
}
