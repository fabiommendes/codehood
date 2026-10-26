import type { ReportKind, ReportStatus } from "@/core/schemas";
import type { Report } from "@/db";
import { m } from "@/i18n";

/// A report as the report islands receive it: plain values, safe to serialise into props.
export interface ReportRow {
	publicId: string;
	kind: ReportKind;
	status: ReportStatus;
	message: string;
	note: string | null;
	url: string | null;
	viewport: string | null;
	author: string;
	/// The course the report was sent from, as `discipline · instructor_edition`.
	course: string | null;
	attachments: { filename: string; url: string }[];
	createdAt: string;
}

/// The report `report` as a {@link ReportRow}.
export function toReportRow(report: Report): ReportRow {
	const { course } = report;
	return {
		publicId: report.publicId,
		kind: report.kind,
		status: report.status,
		message: report.message,
		note: report.note ?? null,
		url: report.url,
		viewport: report.viewport,
		author: report.author,
		course: course
			? `${course.discipline} · ${course.instructor}_${course.edition}`
			: null,
		attachments: report.attachments.map(({ filename, url }) => ({
			filename,
			url,
		})),
		createdAt: report.createdAt.toISOString(),
	};
}

/// The name each report status is shown under.
export const REPORT_STATUS_LABELS: Record<ReportStatus, () => string> = {
	OPEN: m.report_status_open,
	TRIAGED: m.report_status_triaged,
	RESOLVED: m.report_status_resolved,
	DISMISSED: m.report_status_dismissed,
};

/// The name each report type is shown under.
export const REPORT_KIND_LABELS: Record<ReportKind, () => string> = {
	BUG: m.report_kind_bug,
	SUGGESTION: m.report_kind_suggestion,
	CONTENT: m.report_kind_content,
	OTHER: m.report_kind_other,
};
