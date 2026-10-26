import { z } from "zod";
import { m } from "@/i18n";
import { buffer, mimeType, publicId, reportId, username } from "./base";
import { courseNaturalKey, courseRef } from "./course";

/// The shortest message a report may carry, in characters after trimming.
export const REPORT_MESSAGE_MIN = 10;

/// The longest message a report may carry, in characters after trimming.
export const REPORT_MESSAGE_MAX = 4000;

/// How many attachments a report may carry.
export const REPORT_MAX_ATTACHMENTS = 3;

/// The largest attachment of a report, in bytes.
export const REPORT_MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;

/// How many reports one author may send in 24 hours.
export const REPORT_DAILY_LIMIT = 10;

export const reportKind = z.enum(["BUG", "SUGGESTION", "CONTENT", "OTHER"]);
export type ReportKind = z.infer<typeof reportKind>;

export const reportStatus = z.enum([
	"OPEN",
	"TRIAGED",
	"RESOLVED",
	"DISMISSED",
]);
export type ReportStatus = z.infer<typeof reportStatus>;

/// The text of a report, trimmed, from 10 to 4000 characters.
export const reportMessage = z
	.string()
	.trim()
	.min(
		REPORT_MESSAGE_MIN,
		m.forms_schema_report_message_min({ min: REPORT_MESSAGE_MIN }),
	)
	.max(
		REPORT_MESSAGE_MAX,
		m.forms_schema_report_message_max({ max: REPORT_MESSAGE_MAX }),
	);

/**
 * A user's report of a problem, with the status the triage gave it.
 *
 * The internal `id` never leaves the server; `note` is absent for a reader
 * who is only the author.
 */
export const reportSchema = z.object({
	id: reportId,
	publicId: publicId,

	kind: reportKind,
	message: z.string(),
	status: reportStatus,

	/// Written by whoever triages; absent for a reader who is only the author.
	note: z.string().nullable().optional(),

	url: z.string().nullable(),
	userAgent: z.string().nullable(),
	viewport: z.string().nullable(),

	/// The username of the author.
	author: username,
	/// The course the report was sent from; `null` outside a course.
	course: courseNaturalKey.nullable(),

	attachments: z.array(
		z.object({
			filename: z.string().min(1),
			mimeType: mimeType,
			size: z.number().int(),
			url: z.string().min(1),
		}),
	),

	triagedBy: username.nullable(),
	triagedAt: z.date().nullable(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

/// The fields of a new report, before the `CONTENT` rule; use {@link reportCreate}.
export const reportCreateFields = z.object({
	kind: reportKind,
	message: reportMessage,
	url: z.string().max(2000).nullish(),
	userAgent: z.string().max(500).nullish(),
	viewport: z.string().max(50).nullish(),
	course: courseRef.nullish(),
	/// Images only (`.png`, `.jpg`, `.jpeg`, `.webp`); the mime type comes from the extension.
	attachments: z
		.array(z.object({ filename: z.string().min(1), bytes: buffer }))
		.max(REPORT_MAX_ATTACHMENTS)
		.optional(),
});

/// Refuses a `CONTENT` report without a `course`.
function contentNeedsCourse<T extends { kind: string; course?: unknown }>(
	schema: z.ZodType<T>,
) {
	return schema.refine(
		(report) => report.kind !== "CONTENT" || report.course != null,
		{
			path: ["course"],
			message: m.forms_schema_report_course_required(),
		},
	);
}

/// The author of a report is the actor; `CONTENT` needs the `course` it is about.
export const reportCreate = contentNeedsCourse(reportCreateFields);

/// {@link reportCreate} without attachments, for callers that cannot send bytes (the REST API).
export const reportCreateWithoutAttachments = contentNeedsCourse(
	reportCreateFields.omit({ attachments: true }),
);

/// What the triage may change. The author never edits.
export const reportUpdate = z.object({
	status: reportStatus.nullish(),
	kind: reportKind.nullish(),
	note: z.string().max(REPORT_MESSAGE_MAX).nullish(),
});

export const reportPK = z.object({ publicId: publicId });

export const reportFilter = z.object({
	status: z.array(reportStatus).optional(),
	kind: z.array(reportKind).optional(),
	course: courseRef.optional(),
	author: username.optional(),
});

//
// Action inputs
//

/// What the "Report a problem" dialog sends: the report as typed, the context the page captured, and up to three images.
export const reportForm = z.object({
	kind: reportKind,
	message: reportMessage,
	url: z.string().max(2000).optional(),
	userAgent: z.string().max(500).optional(),
	viewport: z.string().max(50).optional(),
	/// The URL segments of the course of the page, when it has one.
	discipline: z.string().optional(),
	course: z.string().optional(),
	images: z
		.array(
			// Checked on use: `File` does not exist where the schemas load in a bare context.
			z.custom<File>(
				(value) => typeof File !== "undefined" && value instanceof File,
			),
		)
		.max(REPORT_MAX_ATTACHMENTS)
		.optional(),
});

/// What the triage form sends, addressing the report by its `publicId`.
export const reportTriageForm = reportUpdate.extend({ publicId: publicId });

/// Addresses one report by its `publicId`.
export const reportRef = z.object({ publicId: publicId });
