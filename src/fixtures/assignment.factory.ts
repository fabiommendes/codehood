import { Factory } from "fishery";
import { db } from "@/db";
import { persistedCourseFactory } from "./course.factory";
import { type PersistParams, serviceOpts } from "./support";

/// The payload `assignmentService.upsert` takes.
type AssignmentInput = Parameters<typeof db.assignment.upsert>[0];
type AssignmentRow = Awaited<ReturnType<typeof db.assignment.upsert>>;

const HOUR_MS = 60 * 60 * 1000;

/// Takes only what it reads: fishery's deep partial of the input does not fit its dates.
function buildAssignment(
	sequence: number,
	params: Partial<AssignmentInput>,
): AssignmentInput {
	return {
		course: params.course ?? (0 as AssignmentInput["course"]),
		slug: params.slug ?? `assignment-${sequence}`,
		title: params.title ?? `Assignment ${sequence}`,
		body: params.body ?? "# Assignment\n\nDo the work.\n",
		opensAt: params.opensAt ?? null,
		dueAt: params.dueAt ?? new Date(Date.now() + 7 * 24 * HOUR_MS),
		closesAt: params.closesAt ?? null,
		teamMin: params.teamMin ?? 1,
		teamMax: params.teamMax ?? 1,
		teamsLockAt: params.teamsLockAt ?? null,
		template: params.template ?? null,
		restrictions: params.restrictions ?? null,
		rev: params.rev ?? null,
	};
}

/** Builds `AssignmentService.upsert` payloads, with an individual assignment due in a week. */
export const assignmentFactory = Factory.define<
	AssignmentInput,
	unknown,
	AssignmentInput,
	Partial<AssignmentInput>
>(({ sequence, params }) => buildAssignment(sequence, params));

/**
 * Builds an `AssignmentService.upsert` payload and persists it.
 *
 * `course` is provisioned automatically (a fresh course) when left unset.
 */
export const persistedAssignmentFactory = Factory.define<
	AssignmentInput,
	PersistParams,
	AssignmentRow,
	Partial<AssignmentInput>
>(({ sequence, params, transientParams, onCreate }) => {
	onCreate(async (input) => {
		const opts = serviceOpts(transientParams);
		const course =
			params.course ??
			(await persistedCourseFactory.create({}, { transient: transientParams }))
				.id;
		return db.assignment.upsert({ ...input, course }, opts);
	});

	return buildAssignment(sequence, params);
});
