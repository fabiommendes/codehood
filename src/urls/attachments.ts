/// The download routes of question and exam attachments, under `/api`.

/// `/api/course/<discipline>/<course>/exam/<exam>`, where `courseSegment` is `<discipline>/<course>`.
function examApi(courseSegment: string, exam: string): string {
	return `/api/course/${courseSegment}/exam/${encodeURIComponent(exam)}`;
}

/** The download URL of the attachment `name` of an exam. */
export function examAttachmentUrl(
	courseSegment: string,
	exam: string,
	name: string,
): string {
	return `${examApi(courseSegment, exam)}/attachment/${encodeURIComponent(name)}`;
}

/** The download URL of the attachment `name` of a question, at the version the exam pins. */
export function examQuestionAttachmentUrl(
	courseSegment: string,
	exam: string,
	question: string,
	name: string,
): string {
	return `${examApi(courseSegment, exam)}/question/${encodeURIComponent(question)}/attachment/${encodeURIComponent(name)}`;
}

/** The download URL of the attachment `name` of a question by public id, at a version label or the latest. */
export function questionAttachmentUrl(
	publicId: string,
	name: string,
	version?: string,
): string {
	const query = version ? `?version=${encodeURIComponent(version)}` : "";
	return `/api/question/${encodeURIComponent(publicId)}/attachment/${encodeURIComponent(name)}${query}`;
}

/** The authenticated download URL of the file `name` an upload answer cites, by the public id of the submission. */
export function examSubmissionFileUrl(
	courseSegment: string,
	exam: string,
	submission: string,
	name: string,
): string {
	return `${examApi(courseSegment, exam)}/submission/${encodeURIComponent(submission)}/file/${encodeURIComponent(name)}`;
}

/** The URL a file is sent to for an upload question of the author's attempt, and which answers the question's files. */
export function examQuestionFilesUrl(
	courseSegment: string,
	exam: string,
	question: string,
): string {
	return `${examApi(courseSegment, exam)}/question/${encodeURIComponent(question)}/file`;
}

/** The URL that removes the file `name` of an upload question of the author's attempt. */
export function examQuestionFileUrl(
	courseSegment: string,
	exam: string,
	question: string,
	name: string,
): string {
	return `${examQuestionFilesUrl(courseSegment, exam, question)}/${encodeURIComponent(name)}`;
}
