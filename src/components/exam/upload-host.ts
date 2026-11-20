import type { UploadFile } from "mdq";
import type { HostResult } from "mdq/solid";
import { m } from "@/i18n";
import { uploadFilename } from "@/services/upload-filename";
import { examQuestionFilesUrl, examQuestionFileUrl } from "@/urls/attachments";

/** What an `upload` question needs from the page besides its answer. */
export interface UploadContext {
	upload: (file: File) => Promise<HostResult<readonly UploadFile[]>>;
	remove: (name: string) => Promise<HostResult<readonly UploadFile[]>>;
	fileUrl: (file: UploadFile) => string | null;
	normalizeName: (name: string) => string;
}

/// The wait the server asks for in `Retry-After`, in ms, or undefined.
function retryAfterMs(response: Response): number | undefined {
	const seconds = Number(response.headers.get("Retry-After"));
	return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}

/// The reason a REST error body gives, or a generic one.
async function refusal(response: Response): Promise<string> {
	try {
		const body = (await response.json()) as {
			message?: unknown;
			errors?: Record<string, { message?: unknown }[]>;
		};
		const reasons = Object.values(body.errors ?? {})
			.flat()
			.flatMap((entry) =>
				typeof entry.message === "string" ? [entry.message] : [],
			);
		if (reasons.length > 0) return reasons.join(" ");
		if (typeof body.message === "string" && body.message) return body.message;
	} catch {
		// Not JSON: fall through to the generic text.
	}
	return m.exams_attempt_connection_failed();
}

/// Sends `request` and reads the `{files, submission}` answer; a network error or 429 is `busy`, and a 401 tells `onSessionLost`.
async function call(
	request: () => Promise<Response>,
	onStored: (submission: string, files: readonly UploadFile[] | null) => void,
	onSessionLost?: () => void,
): Promise<HostResult<readonly UploadFile[]>> {
	let response: Response;
	try {
		response = await request();
	} catch {
		return { ok: false, busy: true };
	}
	if (response.status === 429) {
		return { ok: false, busy: true, retryAfterMs: retryAfterMs(response) };
	}
	if (response.status === 401) onSessionLost?.();
	if (!response.ok) {
		return { ok: false, message: await refusal(response) };
	}
	try {
		const body = (await response.json()) as {
			files: UploadFile[] | null;
			submission: string;
		};
		onStored(body.submission, body.files);
		return { ok: true, value: body.files ?? [] };
	} catch {
		return { ok: false, busy: true };
	}
}

/**
 * The callbacks of an `upload` question of an attempt, over the file routes of the REST API.
 *
 * `onStored` hears each list the server stored with the public id of the submission that holds it.
 */
export function uploadContext(options: {
	courseSegment: string;
	exam: string;
	question: string;
	extensions?: readonly string[] | null;
	submission: () => string | undefined;
	onStored: (submission: string, files: readonly UploadFile[] | null) => void;
	/// Called when the server answers 401, because the session ended.
	onSessionLost?: () => void;
	fileUrl: (submission: string, name: string) => string;
}): UploadContext {
	const { courseSegment, exam, question } = options;
	return {
		upload: (file) =>
			call(
				() => {
					const form = new FormData();
					form.set("file", file);
					form.set("name", file.name);
					return fetch(examQuestionFilesUrl(courseSegment, exam, question), {
						method: "POST",
						body: form,
					});
				},
				options.onStored,
				options.onSessionLost,
			),
		remove: (name) =>
			call(
				() =>
					fetch(examQuestionFileUrl(courseSegment, exam, question, name), {
						method: "DELETE",
					}),
				options.onStored,
				options.onSessionLost,
			),
		fileUrl: (file) => {
			const submission = options.submission();
			return submission ? options.fileUrl(submission, file.name) : null;
		},
		normalizeName: (name) => {
			try {
				return uploadFilename(name, { extensions: options.extensions });
			} catch {
				return name;
			}
		},
	};
}
