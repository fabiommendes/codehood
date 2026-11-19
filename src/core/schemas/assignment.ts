import { z } from "zod";
import { m } from "@/i18n";
import { assignmentId, courseId, instant, rev, slug } from "./base";
import { courseRef } from "./course";
import { repositoryPath } from "./repository";

/// Smallest and largest team an assignment may ask for.
export const MIN_TEAM_SIZE = 1;
export const MAX_TEAM_SIZE = 10;

const teamSize = z.number().int().min(MIN_TEAM_SIZE).max(MAX_TEAM_SIZE);

/// Limits a push must respect. The sizes may only lower the instance's limits,
/// which the service checks: a schema cannot read them.
export const assignmentRestrictions = z.object({
	maxRepoBytes: z.number().int().positive().optional(),
	maxFileBytes: z.number().int().positive().optional(),
	/// Globs of paths no push may add, with the semantics of `path.matchesGlob`.
	deny: z.array(z.string().min(1).max(200)).optional(),
	/// Exact paths the main branch should hold; a missing one only warns.
	require: z.array(repositoryPath).optional(),
});
export type AssignmentRestrictions = z.infer<typeof assignmentRestrictions>;

/// One intermediate date of an assignment.
export const assignmentCheckpoint = z.object({
	slug: slug,
	title: z.string().trim().min(1).max(200),
	at: instant,
});
export type AssignmentCheckpoint = z.infer<typeof assignmentCheckpoint>;

/// The dates and team sizes of an assignment, each one optional.
export type AssignmentRuleFields = {
	teamMin?: number | null;
	teamMax?: number | null;
	opensAt?: Date | null;
	dueAt: Date;
	closesAt?: Date | null;
	teamsLockAt?: Date | null;
	checkpoints?: readonly { slug: string; at: Date }[] | null;
};

/// A rule an assignment breaks: the field to blame and why.
export type AssignmentRuleIssue = {
	path: "teamMax" | "closesAt" | "opensAt" | "teamsLockAt" | "checkpoints";
	message: string;
};

/**
 * Lists the rules the sizes, dates and checkpoints of an assignment break.
 *
 * @example
 * assignmentRuleIssues({ teamMin: 3, teamMax: 2, dueAt: new Date() }); // [{ path: "teamMax", ... }]
 */
export function assignmentRuleIssues(
	fields: AssignmentRuleFields,
): AssignmentRuleIssue[] {
	const issues: AssignmentRuleIssue[] = [];
	const { teamMin, teamMax, opensAt, dueAt, closesAt, teamsLockAt } = fields;
	const checkpoints = fields.checkpoints ?? [];
	if (teamMin != null && teamMax != null && teamMin > teamMax) {
		issues.push({
			path: "teamMax",
			message: m.forms_schema_assignment_team_range(),
		});
	}
	if (closesAt && closesAt < dueAt) {
		issues.push({
			path: "closesAt",
			message: m.forms_schema_assignment_closes_before_due(),
		});
	}
	if (opensAt && opensAt > dueAt) {
		issues.push({
			path: "opensAt",
			message: m.forms_schema_assignment_opens_after_due(),
		});
	}
	if (teamsLockAt && teamsLockAt > dueAt) {
		issues.push({
			path: "teamsLockAt",
			message: m.forms_schema_assignment_lock_after_due(),
		});
	}
	if (new Set(checkpoints.map((c) => c.slug)).size < checkpoints.length) {
		issues.push({
			path: "checkpoints",
			message: m.forms_schema_assignment_checkpoint_duplicate(),
		});
	}
	if (checkpoints.some((c) => c.at >= dueAt)) {
		issues.push({
			path: "checkpoints",
			message: m.forms_schema_assignment_checkpoint_after_due(),
		});
	}
	if (opensAt && checkpoints.some((c) => c.at < opensAt)) {
		issues.push({
			path: "checkpoints",
			message: m.forms_schema_assignment_checkpoint_before_opens(),
		});
	}
	return issues;
}

export const assignmentSchema = z.object({
	id: assignmentId,
	courseId: courseId,
	slug: slug,
	title: z.string().min(1),
	/// The statement, in markdown.
	body: z.string(),
	opensAt: z.date().nullable(),
	dueAt: z.date(),
	closesAt: z.date().nullable(),
	teamMin: z.number().int(),
	teamMax: z.number().int(),
	teamsLockAt: z.date().nullable(),
	/// Slug of the course repository the team repositories start from.
	template: z.string().nullable(),
	restrictions: assignmentRestrictions.nullable(),
	/// Ordered by `at`; empty when the assignment has none.
	checkpoints: z.array(
		z.object({ slug: z.string(), title: z.string(), at: z.date() }),
	),
	rev: z.string().nullable(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

const assignmentFields = z.object({
	course: courseRef,
	slug: slug,
	title: z.string().trim().min(1).max(200),
	body: z.string(),
	opensAt: instant.nullish(),
	dueAt: instant,
	closesAt: instant.nullish(),
	teamMin: teamSize.optional(),
	teamMax: teamSize.optional(),
	teamsLockAt: instant.nullish(),
	template: slug.nullish(),
	restrictions: assignmentRestrictions.nullish(),
	checkpoints: z.array(assignmentCheckpoint).max(20).nullish(),
	rev: rev.nullish(),
});

/// Adds an issue for each order rule the sizes and dates of `input` break.
function checkRules(input: AssignmentRuleFields, ctx: z.RefinementCtx) {
	for (const issue of assignmentRuleIssues(input)) {
		ctx.addIssue({
			code: "custom",
			path: [issue.path],
			message: issue.message,
		});
	}
}

export const assignmentUpsert = assignmentFields.superRefine(checkRules);

/// What a PUT carries: the fields of an upsert, the course and slug being in the path.
export const assignmentPut = assignmentFields
	.omit({ course: true, slug: true })
	.superRefine(checkRules);

export const assignmentPK = z.union([
	z.object({ id: assignmentId }),
	z.object({ course: courseRef, slug: slug }),
]);

export type AssignmentPK = z.infer<typeof assignmentPK>;

export const assignmentFilter = z.object({ course: courseRef });

/// What `remove` takes: `force` also deletes the teams and their repositories.
export const assignmentRemove = z.object({ force: z.boolean().optional() });
