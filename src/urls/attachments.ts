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
