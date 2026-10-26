import { faker } from "@faker-js/faker";
import { Factory } from "fishery";
import { db, type Report, type ReportCreate, type User } from "@/db";
import { type PersistParams, serviceOpts } from "./support";
import { persistedUserFactory } from "./user.factory";

function buildReport(params: Partial<ReportCreate>): ReportCreate {
	return {
		kind: "BUG",
		message: faker.lorem.sentence({ min: 4, max: 12 }),
		url: null,
		userAgent: null,
		viewport: null,
		course: null,
		...(params as Partial<ReportCreate>),
	} as ReportCreate;
}

export interface ReportPersistParams extends PersistParams {
	/**
	 * The user who sends the report. A fresh STUDENT when unset; `actor` is
	 * ignored because the author of a report is always whoever sends it.
	 */
	author?: Pick<User, "username" | "name" | "role">;
}

/** Builds `ReportCreate` payloads, ready for `reportService.create`. */
export const reportFactory = Factory.define<ReportCreate>(({ params }) =>
	buildReport(params as Partial<ReportCreate>),
);

/**
 * Builds a `ReportCreate` payload and persists it via `reportService.create`.
 *
 * Pass `{ transient: { author } }` to choose who sends it; a fresh STUDENT is
 * provisioned otherwise.
 */
export const persistedReportFactory = Factory.define<
	ReportCreate,
	ReportPersistParams,
	Report
>(({ params, transientParams, onCreate }) => {
	onCreate(async (input) => {
		const author =
			transientParams.author ??
			(await persistedUserFactory.create(
				{ role: "STUDENT" },
				{ transient: transientParams },
			));
		return db.report.create(input, {
			...serviceOpts(transientParams),
			actor: {
				username: author.username,
				name: author.name,
				role: author.role,
			},
		});
	});

	return buildReport(params as Partial<ReportCreate>);
});
