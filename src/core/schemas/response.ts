import { z } from "zod";
import {
	buffer,
	courseId,
	examId,
	instant,
	publicId,
	responseId,
	slug,
	username,
} from "./base";
import { courseRef } from "./course";
import {
	responseRef,
	submissionKindRequested,
	submissionPayload,
	submissionSchema,
} from "./submission";

export const responsePK = responseRef;

export const responseSchema = z.object({
	id: responseId,
	publicId: publicId,

	courseId: courseId,
	examId: examId,
	/// The exam this attempt belongs to, by slug.
	exam: slug,

	author: username,

	/**
	 * When this practice session started, or `null` for a graded exam.
	 *
	 * The stored form is `slotKey`, an integer the unique index can constrain;
	 * a graded exam's zero surfaces here as `null`.
	 */
	practiceSession: z.date().nullable(),

	acceptingSubmissions: z.boolean(),

	/// Whether this is the course instructor's simulation of the exam. Server state: never written by a client.
	preview: z.boolean(),

	/// The instructor who created this attempt for a student who did not take the exam, or `null` for the student's own. Server state: never written by a client.
	createdBy: username.nullable(),

	/// When the attempt was closed, or `null` while it is open or when it was closed before the server recorded it. Server state: never written by a client.
	closedAt: z.date().nullable(),

	/// The submissions of this attempt, oldest first. A listing holds only the ones that count for each question: every send, the newest one, the student's newest when the instructor created the newest, and those under a regrade request.
	submissions: z.array(submissionSchema),

	createdAt: z.date(),
	updatedAt: z.date(),
});

export const responseCreate = responseSchema
	.omit({
		id: true,
		publicId: true,
		courseId: true,
		examId: true,
		exam: true,
		author: true,
		practiceSession: true,
		submissions: true,
		closedAt: true,
		preview: true,
		createdBy: true,
		createdAt: true,
		updatedAt: true,
	})
	.extend({
		course: courseRef,
		exam: slug,

		/// Defaults to the actor, who is the only author a student may write.
		author: username.optional(),

		/**
		 * Which attempt at a practice exam this is, defaulting to the session
		 * open now. Refused on a graded exam, which a student answers once.
		 */
		practiceSession: instant.nullish(),

		acceptingSubmissions: z.boolean().optional(),
	});

/// Closing or reopening the attempt is the only field a caller moves directly.
export const responseUpdate = responseSchema
	.pick({ acceptingSubmissions: true })
	.partial();

export const responseFilterBase = z.object({
	exam: slug.optional(),
	author: username.optional(),

	/// `true` keeps only practice attempts, `false` only graded ones.
	practice: z.boolean().optional(),

	acceptingSubmissions: z.boolean().optional(),

	/// `true` keeps only the instructor's simulations, which are left out by default.
	preview: z.boolean().optional(),

	/// `true` lists each attempt with every submission it holds, instead of only the ones that count.
	history: z.boolean().optional(),
});

export const responseFilter = responseFilterBase.extend({ course: courseRef });

/**
 * Answers one question of an exam, resolving the attempt it belongs to.
 *
 * The client that answers a question does not know whether it has started the
 * exam already, and should not have to ask.
 */
/// Closes one student's graded attempt to further answers.
export const responseFinish = z.object({
	course: courseRef,
	exam: slug,

	/// Defaults to the actor.
	author: username.optional(),
});

/// Which closed attempts `response.gradeObjectives` grades.
export const responseGradeObjectives = z.object({
	course: courseRef,

	/// Every exam of the course when absent.
	exam: slug.optional(),

	/// Counts what would be graded and writes nothing.
	dryRun: z.boolean().optional(),

	/// Includes exams whose grades were already released.
	released: z.boolean().optional(),
});

/// The attempts `response.settleExpired` grades: all of an exam's, or one author's.
export const responseSettleExpired = z.object({
	course: courseRef,
	exam: slug,

	/// Every attempt of the exam when absent; a student may only name themselves.
	author: username.optional(),
});

/// Opens the instructor's simulation of an exam anew, in place of the one they have.
export const responseRestartPreview = z.object({
	course: courseRef,
	exam: slug,
});

export const responseSubmit = z.object({
	course: courseRef,
	exam: slug,
	question: slug,

	/// Defaults to the actor.
	author: username.optional(),

	payload: submissionPayload,
	/// `SUBMIT` sends a `code` answer to its worker. Defaults to `AUTOSAVE`.
	kind: submissionKindRequested.optional(),
	startedAt: instant.nullish(),
	automaticallyTriggered: z.boolean().optional(),
});

/// What `response.submit` answers: the attempt, and whether the code sent was already sent, so nothing was queued or spent.
export const responseSubmitted = responseSchema.extend({
	duplicate: z.boolean(),
});

/// What the exam page reads back after saving an answer.
export const responseAnswered = z.object({
	/// The attempt the answer went to, by `publicId`.
	response: publicId,
	/// Whether the browser records the edit history of open answers in the exam.
	answerHistory: z.boolean(),
	/// Whether the code sent was already sent, so nothing was queued or spent.
	duplicate: z.boolean(),
});

/// Sends one file to an upload question of an attempt.
export const responseUploadFile = z.object({
	course: courseRef,
	exam: slug,
	question: slug,

	/// Defaults to the actor.
	author: username.optional(),

	/// The name as the client gave it; the stored name is derived from it.
	filename: z.string().min(1),
	bytes: buffer,
});

/// The multipart body of a file sent over REST: the bytes, and the name as text since the file part carries none.
export const responseFileUpload = z.object({
	file: buffer,
	name: z.string().min(1),
});

/// Removes one file, by its stored name, from an upload question of an attempt.
export const responseRemoveFile = responseUploadFile.omit({ bytes: true });

/// Reads one file an upload answer cites, by the public id of the submission and the name it stores.
export const responseSubmissionFile = z.object({
	course: courseRef,
	exam: slug,
	submission: publicId,
	name: z.string().min(1),
});

/// A file an upload answer cites, as a stream of its bytes with their size and mime type.
export const responseFileContent = z.object({
	stream: z.custom<ReadableStream<Uint8Array>>(
		(value) =>
			typeof ReadableStream !== "undefined" && value instanceof ReadableStream,
	),
	size: z.number(),
	mimeType: z.string(),
});

/// The answer to an upload question after a file was sent or removed: its list of files, or `null` when none is left, and the submission that holds it.
export const responseFileList = z.object({
	files: z
		.array(z.object({ name: z.string(), path: z.string(), size: z.number() }))
		.min(1)
		.nullable(),
	submission: publicId,
});
