import {
	type ReportKind,
	type ReportStatus,
	reportKind,
	reportStatus,
} from "@/core/schemas";

/// The value the filter selects take for "no filter".
export const ALL_REPORTS = "ALL";

/// What a report queue page shows, read from its query string.
export interface ReportFilters {
	/// `null` shows every status.
	status: ReportStatus | null;
	/// `null` shows every type.
	kind: ReportKind | null;
}

/// The filters in `params`: `OPEN` reports unless a status (or `ALL`) is asked for, of any type unless one is.
export function parseReportFilters(params: URLSearchParams): ReportFilters {
	const status = params.get("status");
	const kind = params.get("kind");
	return {
		status:
			status === null ? "OPEN" : (reportStatus.safeParse(status).data ?? null),
		kind: reportKind.safeParse(kind).data ?? null,
	};
}
