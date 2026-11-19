/**
 * Teams of an assignment and the repository each one owns: students form and
 * leave teams, the instructor composes them, and every push to a team's
 * `main` is recorded here.
 *
 * Rows go first and the folder second, so a failed disk leaves the rows undone
 * and a folder is deleted only after the transaction that dropped its rows has
 * closed.
 */
import { randomInt } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { z } from "zod";
import { type Actor, SYSTEM, type UserActor } from "@/auth/actor";
import { type CourseWithEnrollment, hasPerm } from "@/auth/permissions";
import { generateToken } from "@/auth/token";
import { PUBLIC_URL, TEAM_TEMP_TOKEN_TTL_MS } from "@/core/constants";
import { InvalidData, NotAllowed, NotFound } from "@/core/error";
import {
	type AssignmentPK,
	assignmentPK,
	type assignmentRestrictions,
} from "@/core/schemas/assignment";
import {
	type AssignmentId,
	type CourseId,
	instant,
	type TeamId,
	username,
} from "@/core/schemas/base";
import {
	teamCreate,
	teamCreateFor,
	teamJoin,
	teamListedSchema,
	teamMineSchema,
	teamMissingFiles,
	teamName,
	teamPK,
	teamPushInput,
	teamPushSchema,
	teamSchema,
	teamSummarySchema,
} from "@/core/schemas/team";
import type { ServiceOpts, ServiceOptsWithoutTx } from "@/db/base-service";
import { rejectExpectedUpdatedAt } from "@/db/conditional-write";
import { defineService, inTx, op } from "@/db/define-service";
import { m } from "@/i18n";
import {
	checkpointDeliveries,
	teamDelivery,
} from "@/services/assignment-delivery";
import * as bare from "@/services/git/bare";
import { type GitObjectKind, parseTree } from "@/services/git/objects";
import {
	assignmentInclude,
	checkpointsOf,
	type DbAssignment,
	findAssignment,
	isEnrolledStudent,
	isIndividual,
	restrictionsOf,
	teamsAreLocked,
	visibleAssignment,
} from "../assignment-access";
import type { Prisma, PrismaClient, PrismaTx } from "../client";
import { prisma } from "../client";
import { invalidIfExists } from "../utils";
import { type BlobService, makeBlobService } from "./blob.service";

export type TeamPK = z.infer<typeof teamPK>;
export type TeamCreate = z.infer<typeof teamCreate>;
export type TeamCreateFor = z.infer<typeof teamCreateFor>;
export type TeamJoin = z.infer<typeof teamJoin>;
export type TeamPushInput = z.infer<typeof teamPushInput>;
/// A team as one of its members sees it.
export type TeamMine = z.infer<typeof teamMineSchema>;
/// A team as the instructor sees it.
export type Team = z.infer<typeof teamSchema>;
export type TeamListed = z.infer<typeof teamListedSchema>;
export type TeamPush = z.infer<typeof teamPushSchema>;
export type TeamSummary = z.infer<typeof teamSummarySchema>;

/// What the service needs from the disk: the repositories of the teams.
export type TeamDisk = Pick<
	typeof bare,
	"createBareRepository" | "removeBareRepository" | "readMain" | "listPaths"
>;

/** Options a caller may override, injected so tests can pin them. */
export type TeamServiceOptions = {
	/// Origin of the clone URLs. Defaults to `PUBLIC_URL`.
	publicUrl?: string;
};

/// What a clone URL resolves to: the member, their team and the assignment.
export type TeamAccess = {
	member: { username: string; name: string };
	team: {
		id: TeamId;
		publicId: string;
		name: string;
		/// The team's deadline: its own extension, or the assignment's.
		dueAt: Date;
		baseSha: string | null;
	};
	assignment: {
		id: number;
		slug: string;
		courseId: number;
		opensAt: Date | null;
		dueAt: Date;
		closesAt: Date | null;
		restrictions: z.infer<typeof assignmentRestrictions> | null;
	};
	/// Whether the member's enrollment is active; a dropped one keeps the
	/// membership but cannot clone or push.
	enrolled: boolean;
};

/**
 * The team service of `client` (the shared client by default).
 *
 * Besides the operations it carries the functions that touch the disk and so
 * span more than one transaction (`create`, `createFor`, `leave`, `remove`,
 * `reconcile`, `missingFiles`), and `findByToken`, which takes no actor: the
 * token is the credential (ADR 0005).
 */
export function makeTeamService(
	disk: TeamDisk = bare,
	blobStore: Pick<BlobService, "blobPath"> = makeBlobService(),
	client: PrismaClient = prisma,
	options: TeamServiceOptions = {},
) {
	const publicUrl = options.publicUrl ?? PUBLIC_URL;

	/// Runs a read on `opts.tx` or on the client, with no transaction of its own.
	function direct<R>(
		opts: ServiceOpts,
		fn: (tx: PrismaTx, scoped: ServiceOptsWithoutTx) => Promise<R>,
	): Promise<R> {
		const { tx, ...scoped } = opts;
		return fn((tx ?? client) as PrismaTx, scoped);
	}

	/// Deletes the folders of teams whose rows are gone; one that stays is left to `prune-team-repositories`.
	async function dropFolders(ids: number[]): Promise<void> {
		await Promise.allSettled(ids.map((id) => disk.removeBareRepository(id)));
	}

	/// Creates the folder of a team that has rows already, undoing them if the disk fails.
	async function createFolder(
		teamId: number,
		seed: TemplateSeed | null,
		opts: ServiceOpts,
	): Promise<void> {
		try {
			await disk.createBareRepository(
				teamId,
				seed ? seedFrom(seed, blobStore) : undefined,
			);
		} catch (error) {
			try {
				await (opts.tx ?? client).team.deleteMany({ where: { id: teamId } });
			} catch {
				// The original error is the one to surface.
			}
			throw error;
		}
	}

	//
	// Students
	//

	/// The rows of `create`, and what the folder needs.
	const createRows = op({
		args: [assignmentPK, teamCreate],
		run: async (
			tx: PrismaTx,
			pk: AssignmentPK,
			input: TeamCreate,
			opts: ServiceOptsWithoutTx,
		) => {
			rejectExpectedUpdatedAt(opts);
			const assignment = await visibleAssignment(tx, pk, opts.actor);
			const student = studentOf(assignment, opts.actor, "team.create");
			ensureOpen(assignment, "team.create");
			const individual = isIndividual(assignment);
			const name = individual ? student : input.name;
			await ensureNotInTeam(tx, assignment.id, student);
			await ensureNameFree(tx, assignment.id, name, null);
			const seed = await templateSeed(tx, assignment.template);

			const team = await invalidIfExists(async () => {
				const created = await tx.team.create({
					data: {
						publicId: generateToken(9),
						assignmentId: assignment.id,
						name,
						joinCode: individual ? null : await freshJoinCode(tx),
						baseSha: seed?.head ?? null,
					},
				});
				await tx.teamMember.create({
					data: {
						teamId: created.id,
						assignmentId: assignment.id,
						username: student,
						token: generateToken(24),
					},
				});
				return created;
			});
			const row = await findTeam(tx, { id: team.id as TeamId }, opts.actor);
			return {
				teamId: team.id,
				seed,
				mine: await toMine(tx, row, student, publicUrl),
			};
		},
	});

	/**
	 * Makes a team of the student `opts.actor`, who becomes its first member,
	 * with its repository: empty, or the head commit of the assignment's
	 * template, which is not recorded as a push.
	 *
	 * An individual assignment names the team after the student and gives it
	 * no join code. The rows commit before the folder is made; if the folder
	 * fails, the rows are undone and the error surfaces. With `opts.tx`, the
	 * folder is made before the caller commits.
	 *
	 * @throws {@link NotFound} If the assignment is not visible to the actor.
	 * @throws {@link NotAllowed} `team.create` if the actor is not a student
	 * with an active enrollment, or teams are locked.
	 * @throws {@link InvalidData} If the student is already in a team of the
	 * assignment, the name is taken or missing, or the disk failed.
	 */
	async function create(
		pk: AssignmentPK,
		input: TeamCreate,
		opts: ServiceOpts,
	): Promise<TeamMine> {
		const made = await inTx(client, opts, (tx, scoped) =>
			createRows(tx, pk, input, scoped),
		);
		await createFolder(made.teamId, made.seed, opts);
		return checked(teamMineSchema, made.mine, opts);
	}

	/**
	 * Puts the student `opts.actor` in the team that has `input.joinCode`.
	 *
	 * @throws {@link NotFound} If the assignment is not visible to the actor.
	 * @throws {@link NotAllowed} `team.update` if the actor is not a student
	 * with an active enrollment, or teams are locked.
	 * @throws {@link InvalidData} If the code names no team of this
	 * assignment, the team is full, or the student is in another team.
	 */
	const join = op({
		returns: teamMineSchema,
		args: [assignmentPK, teamJoin],
		run: async (
			tx: PrismaTx,
			pk: AssignmentPK,
			input: TeamJoin,
			opts: ServiceOptsWithoutTx,
		): Promise<TeamMine> => {
			rejectExpectedUpdatedAt(opts);
			const assignment = await visibleAssignment(tx, pk, opts.actor);
			const student = studentOf(assignment, opts.actor, "team.update");
			ensureOpen(assignment, "team.update");
			const unknown = new InvalidData({
				joinCode: [
					{
						code: "not-exists",
						message: m.errors_team_join_code_unknown(),
					},
				],
			});
			const found = isIndividual(assignment)
				? null
				: await tx.team.findUnique({
						where: { joinCode: input.joinCode.toUpperCase() },
						select: { id: true, assignmentId: true },
					});
			if (!found || found.assignmentId !== assignment.id) throw unknown;
			await ensureNotInTeam(tx, assignment.id, student);

			const full = new InvalidData({
				joinCode: [{ code: "invalid", message: m.errors_team_full() }],
			});
			const seats = () => tx.teamMember.count({ where: { teamId: found.id } });
			if ((await seats()) >= assignment.teamMax) throw full;
			await invalidIfExists(() =>
				tx.teamMember.create({
					data: {
						teamId: found.id,
						assignmentId: assignment.id,
						username: student,
						token: generateToken(24),
					},
				}),
			);
			// The check and the insert share one transaction, but the count
			// after the insert is what guarantees the last seat has one owner.
			if ((await seats()) > assignment.teamMax) throw full;

			const row = await findTeam(tx, { id: found.id as TeamId }, opts.actor);
			return toMine(tx, row, student, publicUrl);
		},
	});

	/// The rows of `leave`: the folders to drop once they are gone.
	const leaveRows = op({
		args: [teamPK],
		run: async (
			tx: PrismaTx,
			pk: TeamPK,
			opts: ServiceOptsWithoutTx,
		): Promise<number[]> => {
			rejectExpectedUpdatedAt(opts);
			const { team, student } = await ownTeam(tx, pk, opts.actor);
			if (isIndividual(team.assignment)) {
				throw new InvalidData({
					$: [{ code: "invalid", message: m.errors_team_individual() }],
				});
			}
			ensureOpen(team.assignment, "team.update");
			if (team.members.length > 1) {
				await tx.teamMember.delete({
					where: { teamId_username: { teamId: team.id, username: student } },
				});
				return [];
			}
			if ((await tx.teamPush.count({ where: { teamId: team.id } })) > 0) {
				throw new InvalidData({
					$: [
						{
							code: "invalid",
							message: m.errors_team_last_member_pushed(),
						},
					],
				});
			}
			await tx.team.delete({ where: { id: team.id } });
			return [team.id];
		},
	});

	/**
	 * Takes the student `opts.actor` out of the team and drops their token. The
	 * last member of a team with no push deletes the team and its folder.
	 *
	 * @throws {@link NotFound} If the actor is not a member of the team.
	 * @throws {@link NotAllowed} `team.update` if teams are locked.
	 * @throws {@link InvalidData} If the assignment is individual, or the
	 * actor is the last member of a team that has pushed.
	 */
	async function leave(pk: TeamPK, opts: ServiceOpts): Promise<void> {
		const folders = await inTx(client, opts, (tx, scoped) =>
			leaveRows(tx, pk, scoped),
		);
		await dropFolders(folders);
	}

	/**
	 * Replaces the token of the actor's own membership, so the old clone URL
	 * stops resolving, and drops their temporary token. It works after teams lock.
	 *
	 * @throws {@link NotFound} If the actor is not a member of the team.
	 */
	const rotateToken = op({
		returns: teamMineSchema,
		args: [teamPK],
		run: async (
			tx: PrismaTx,
			pk: TeamPK,
			opts: ServiceOptsWithoutTx,
		): Promise<TeamMine> => {
			rejectExpectedUpdatedAt(opts);
			const { team, student } = await ownTeam(tx, pk, opts.actor);
			await tx.teamMember.update({
				where: { teamId_username: { teamId: team.id, username: student } },
				data: {
					token: generateToken(24),
					tempToken: null,
					tempTokenExpiresAt: null,
				},
			});
			const row = await findTeam(tx, { id: team.id as TeamId }, opts.actor);
			return toMine(tx, row, student, publicUrl);
		},
	});

	/**
	 * Gives the actor's own membership a temporary token, valid for
	 * {@link TEAM_TEMP_TOKEN_TTL_MS} and not renewed by use, so the one before
	 * stops resolving. It works after teams lock.
	 *
	 * @throws {@link NotFound} If the actor is not a member of the team.
	 */
	const createTempToken = op({
		returns: teamMineSchema,
		args: [teamPK],
		run: async (
			tx: PrismaTx,
			pk: TeamPK,
			opts: ServiceOptsWithoutTx,
		): Promise<TeamMine> => {
			rejectExpectedUpdatedAt(opts);
			const { team, student } = await ownTeam(tx, pk, opts.actor);
			await tx.teamMember.update({
				where: { teamId_username: { teamId: team.id, username: student } },
				data: {
					tempToken: generateToken(24),
					tempTokenExpiresAt: new Date(Date.now() + TEAM_TEMP_TOKEN_TTL_MS),
				},
			});
			const row = await findTeam(tx, { id: team.id as TeamId }, opts.actor);
			return toMine(tx, row, student, publicUrl);
		},
	});

	/**
	 * Drops the temporary token of the actor's own membership, if there is one.
	 *
	 * @throws {@link NotFound} If the actor is not a member of the team.
	 */
	const revokeTempToken = op({
		returns: teamMineSchema,
		args: [teamPK],
		run: async (
			tx: PrismaTx,
			pk: TeamPK,
			opts: ServiceOptsWithoutTx,
		): Promise<TeamMine> => {
			rejectExpectedUpdatedAt(opts);
			const { team, student } = await ownTeam(tx, pk, opts.actor);
			await tx.teamMember.update({
				where: { teamId_username: { teamId: team.id, username: student } },
				data: { tempToken: null, tempTokenExpiresAt: null },
			});
			const row = await findTeam(tx, { id: team.id as TeamId }, opts.actor);
			return toMine(tx, row, student, publicUrl);
		},
	});

	/**
	 * The team of the actor in the assignment, with the join code (until teams
	 * lock) and the actor's own tokens; `null` when they have none.
	 *
	 * @throws {@link NotFound} If the assignment is not visible to the actor.
	 */
	const findMine = op({
		transaction: false,
		returns: teamMineSchema.nullable(),
		args: [assignmentPK],
		run: async (
			tx: PrismaTx,
			pk: AssignmentPK,
			opts: ServiceOptsWithoutTx,
		): Promise<TeamMine | null> => {
			const assignment = await visibleAssignment(tx, pk, opts.actor);
			if (opts.actor === SYSTEM) return null;
			const member = await tx.teamMember.findUnique({
				where: {
					assignmentId_username: {
						assignmentId: assignment.id,
						username: opts.actor.username,
					},
				},
				select: { teamId: true },
			});
			if (!member) return null;
			const row = await findTeam(
				tx,
				{ id: member.teamId as TeamId },
				opts.actor,
			);
			return toMine(tx, row, opts.actor.username, publicUrl);
		},
	});

	//
	// The instructor
	//

	/// The rows of `createFor`, and what the folder needs.
	const createForRows = op({
		args: [assignmentPK, teamCreateFor],
		run: async (
			tx: PrismaTx,
			pk: AssignmentPK,
			input: TeamCreateFor,
			opts: ServiceOptsWithoutTx,
		) => {
			rejectExpectedUpdatedAt(opts);
			const assignment = await findAssignment(tx, pk, opts.actor);
			if (!assignment) throw new NotFound("assignment");
			managed(assignment.course, opts.actor, "team.create");
			if (isIndividual(assignment)) throw individualRefusal();
			const members = [...new Set(input.members)];
			await ensureEnrolled(tx, assignment.courseId, members);
			await ensureNameFree(tx, assignment.id, input.name, null);
			for (const member of members) {
				await ensureNotInTeam(tx, assignment.id, member);
			}
			const seed = await templateSeed(tx, assignment.template);

			const team = await invalidIfExists(async () => {
				const created = await tx.team.create({
					data: {
						publicId: generateToken(9),
						assignmentId: assignment.id,
						name: input.name,
						joinCode: await freshJoinCode(tx),
						baseSha: seed?.head ?? null,
					},
				});
				for (const member of members) {
					await tx.teamMember.create({
						data: {
							teamId: created.id,
							assignmentId: assignment.id,
							username: member,
							token: generateToken(24),
						},
					});
				}
				return created;
			});
			const row = await findTeam(tx, { id: team.id as TeamId }, opts.actor);
			return { teamId: team.id, seed, team: toTeam(row) };
		},
	});

	/**
	 * Makes a team with the given students (possibly none) and its repository,
	 * as the instructor: no lock date and no size limit apply.
	 *
	 * @throws {@link NotFound} If the assignment does not exist.
	 * @throws {@link NotAllowed} `team.create` if the actor lacks
	 * `enrollment.manage`.
	 * @throws {@link InvalidData} If the assignment is individual, a student
	 * has no active enrollment or is in another team, or the name is taken.
	 */
	async function createFor(
		pk: AssignmentPK,
		input: TeamCreateFor,
		opts: ServiceOpts,
	): Promise<Team> {
		const made = await inTx(client, opts, (tx, scoped) =>
			createForRows(tx, pk, input, scoped),
		);
		await createFolder(made.teamId, made.seed, opts);
		return checked(teamSchema, made.team, opts);
	}

	/**
	 * Puts an active student in the team. One who was in another team of the
	 * assignment leaves it and gets a new token; their pushes stay where they
	 * were.
	 *
	 * @throws {@link NotFound} If the team does not exist.
	 * @throws {@link NotAllowed} `team.update` if the actor lacks `enrollment.manage`.
	 * @throws {@link InvalidData} If the assignment is individual, or the user
	 * has no active enrollment in the course.
	 */
	const addMember = op({
		returns: teamSchema,
		args: [teamPK, username],
		run: async (
			tx: PrismaTx,
			pk: TeamPK,
			student: string,
			opts: ServiceOptsWithoutTx,
		): Promise<Team> => {
			rejectExpectedUpdatedAt(opts);
			const team = await findTeam(tx, pk, opts.actor);
			managed(team.assignment.course, opts.actor, "team.update");
			if (isIndividual(team.assignment)) throw individualRefusal();
			await ensureEnrolled(tx, team.assignment.courseId, [student]);
			if (!team.members.some((member) => member.username === student)) {
				await tx.teamMember.deleteMany({
					where: { assignmentId: team.assignmentId, username: student },
				});
				await tx.teamMember.create({
					data: {
						teamId: team.id,
						assignmentId: team.assignmentId,
						username: student,
						token: generateToken(24),
					},
				});
			}
			return toTeam(await findTeam(tx, { id: team.id as TeamId }, opts.actor));
		},
	});

	/**
	 * Takes a student out of the team and drops their token. The team stays,
	 * with its repository and pushes, even with no members left.
	 *
	 * @throws {@link NotFound} If the team does not exist, or the user is not a member.
	 * @throws {@link NotAllowed} `team.update` if the actor lacks `enrollment.manage`.
	 * @throws {@link InvalidData} If the assignment is individual.
	 */
	const removeMember = op({
		returns: teamSchema,
		args: [teamPK, username],
		run: async (
			tx: PrismaTx,
			pk: TeamPK,
			student: string,
			opts: ServiceOptsWithoutTx,
		): Promise<Team> => {
			rejectExpectedUpdatedAt(opts);
			const team = await findTeam(tx, pk, opts.actor);
			managed(team.assignment.course, opts.actor, "team.update");
			if (isIndividual(team.assignment)) throw individualRefusal();
			const gone = await tx.teamMember.deleteMany({
				where: { teamId: team.id, username: student },
			});
			if (gone.count === 0) throw new NotFound("team-member");
			return toTeam(await findTeam(tx, { id: team.id as TeamId }, opts.actor));
		},
	});

	/**
	 * Gives the team its own deadline, or `null` to go back to the assignment's.
	 *
	 * @throws {@link NotFound} If the team does not exist.
	 * @throws {@link NotAllowed} `team.update` if the actor lacks `enrollment.manage`.
	 */
	const setDueAt = op({
		returns: teamSchema,
		args: [teamPK, instant.nullable()],
		run: async (
			tx: PrismaTx,
			pk: TeamPK,
			dueAt: Date | null,
			opts: ServiceOptsWithoutTx,
		): Promise<Team> => {
			rejectExpectedUpdatedAt(opts);
			const team = await findTeam(tx, pk, opts.actor);
			managed(team.assignment.course, opts.actor, "team.update");
			await tx.team.update({ where: { id: team.id }, data: { dueAt } });
			return toTeam(await findTeam(tx, { id: team.id as TeamId }, opts.actor));
		},
	});

	/**
	 * Renames the team.
	 *
	 * @throws {@link NotFound} If the team does not exist.
	 * @throws {@link NotAllowed} `team.update` if the actor lacks `enrollment.manage`.
	 * @throws {@link InvalidData} If the assignment is individual, or another
	 * team has the name.
	 */
	const rename = op({
		returns: teamSchema,
		args: [teamPK, teamName],
		run: async (
			tx: PrismaTx,
			pk: TeamPK,
			name: string,
			opts: ServiceOptsWithoutTx,
		): Promise<Team> => {
			rejectExpectedUpdatedAt(opts);
			const team = await findTeam(tx, pk, opts.actor);
			managed(team.assignment.course, opts.actor, "team.update");
			if (isIndividual(team.assignment)) throw individualRefusal();
			await ensureNameFree(tx, team.assignmentId, name, team.id);
			await invalidIfExists(() =>
				tx.team.update({ where: { id: team.id }, data: { name } }),
			);
			return toTeam(await findTeam(tx, { id: team.id as TeamId }, opts.actor));
		},
	});

	/// The rows of `remove`: the folder to drop once they are gone.
	const removeRows = op({
		args: [teamPK],
		run: async (
			tx: PrismaTx,
			pk: TeamPK,
			opts: ServiceOptsWithoutTx,
		): Promise<number[]> => {
			rejectExpectedUpdatedAt(opts);
			const team = await findTeam(tx, pk, opts.actor);
			managed(team.assignment.course, opts.actor, "team.delete");
			await tx.team.delete({ where: { id: team.id } });
			return [team.id];
		},
	});

	/**
	 * Deletes the team, its members, its pushes and its repository folder. The
	 * folder goes after the transaction closes.
	 *
	 * @throws {@link NotFound} If the team does not exist.
	 * @throws {@link NotAllowed} `team.delete` if the actor lacks `enrollment.manage`.
	 */
	async function remove(pk: TeamPK, opts: ServiceOpts): Promise<void> {
		const folders = await inTx(client, opts, (tx, scoped) =>
			removeRows(tx, pk, scoped),
		);
		await dropFolders(folders);
	}

	/**
	 * Lists the teams of an assignment with their members and deliveries,
	 * never with tokens or join codes.
	 *
	 * @throws {@link NotFound} If the assignment does not exist.
	 * @throws {@link NotAllowed} `team.read` if the actor lacks `enrollment.manage`.
	 */
	const listWithDeliveries = op({
		transaction: false,
		returns: teamListedSchema.array(),
		args: [assignmentPK],
		run: async (
			tx: PrismaTx,
			pk: AssignmentPK,
			opts: ServiceOptsWithoutTx,
		): Promise<TeamListed[]> => {
			const assignment = await findAssignment(tx, pk, opts.actor);
			if (!assignment) throw new NotFound("assignment");
			managed(assignment.course, opts.actor, "team.read");
			const rows = await tx.team.findMany({
				where: { assignmentId: assignment.id },
				include: MEMBERS_INCLUDE,
				orderBy: [{ name: "asc" }, { id: "asc" }],
			});
			const pushes = await pushesOf(tx, { assignmentId: assignment.id });
			const checkpoints = checkpointsOf(assignment);
			return rows.map((row) => {
				const team = toTeam({ ...row, assignment });
				const own = pushes.get(row.id) ?? [];
				return {
					...team,
					delivery: teamDelivery(own, team.dueAt),
					checkpoints: checkpointDeliveries(own, checkpoints),
					sizeException: sizeException(row.members.length, assignment),
				};
			});
		},
	});

	/**
	 * Counts the teams, the active students with no team, the teams with an
	 * on-time delivery, the teams with only a late one and the teams with a
	 * push at each checkpoint that has passed.
	 *
	 * @throws {@link NotFound} If the assignment does not exist.
	 * @throws {@link NotAllowed} `team.read` if the actor lacks `enrollment.manage`.
	 */
	const summary = op({
		transaction: false,
		returns: teamSummarySchema,
		args: [assignmentPK],
		run: async (
			tx: PrismaTx,
			pk: AssignmentPK,
			opts: ServiceOptsWithoutTx,
		): Promise<TeamSummary> => {
			const assignment = await findAssignment(tx, pk, opts.actor);
			if (!assignment) throw new NotFound("assignment");
			managed(assignment.course, opts.actor, "team.read");
			const teams = await tx.team.findMany({
				where: { assignmentId: assignment.id },
				select: { id: true, dueAt: true },
			});
			const studentsWithoutTeam = await tx.enrollment.count({
				where: {
					courseId: assignment.courseId,
					status: "ACTIVE",
					user: { teamMemberships: { none: { assignmentId: assignment.id } } },
				},
			});
			const pushes = await pushesOf(tx, { assignmentId: assignment.id });
			const now = new Date();
			const passed = checkpointsOf(assignment).filter(
				(checkpoint) => checkpoint.at <= now,
			);
			const reached = new Map(passed.map(({ slug }) => [slug, 0]));
			let onTime = 0;
			let lateOnly = 0;
			for (const team of teams) {
				const own = pushes.get(team.id) ?? [];
				const delivery = teamDelivery(own, team.dueAt ?? assignment.dueAt);
				if (delivery.onTime) onTime++;
				else if (delivery.late) lateOnly++;
				for (const { slug, push } of checkpointDeliveries(own, passed)) {
					if (push) reached.set(slug, (reached.get(slug) ?? 0) + 1);
				}
			}
			return {
				teams: teams.length,
				studentsWithoutTeam,
				onTime,
				lateOnly,
				checkpoints: passed.map(({ slug }) => ({
					slug,
					teams: reached.get(slug) ?? 0,
				})),
			};
		},
	});

	/**
	 * How many pushes each team of an assignment has, by team id; a team with
	 * none is absent.
	 *
	 * @throws {@link NotFound} If the assignment does not exist.
	 * @throws {@link NotAllowed} `team.read` if the actor lacks `enrollment.manage`.
	 */
	const pushCounts = op({
		transaction: false,
		args: [assignmentPK],
		run: async (
			tx: PrismaTx,
			pk: AssignmentPK,
			opts: ServiceOptsWithoutTx,
		): Promise<Record<number, number>> => {
			const assignment = await findAssignment(tx, pk, opts.actor);
			if (!assignment) throw new NotFound("assignment");
			managed(assignment.course, opts.actor, "team.read");
			const rows = await tx.teamPush.groupBy({
				by: ["teamId"],
				where: { team: { assignmentId: assignment.id } },
				_count: { _all: true },
			});
			return Object.fromEntries(rows.map((r) => [r.teamId, r._count._all]));
		},
	});

	//
	// Pushes
	//

	/**
	 * Records an accepted push to the team's `main`. Only the server itself
	 * records pushes. Recording the sha that already is the last one is a no-op.
	 *
	 * @throws {@link NotAllowed} `team.update` unless the actor is `SYSTEM`.
	 * @throws {@link NotFound} If the team does not exist.
	 */
	const recordPush = op({
		returns: teamPushSchema,
		args: [teamPK, teamPushInput],
		run: async (
			tx: PrismaTx,
			pk: TeamPK,
			input: TeamPushInput,
			opts: ServiceOptsWithoutTx,
		): Promise<TeamPush> => {
			rejectExpectedUpdatedAt(opts);
			if (opts.actor !== SYSTEM) throw new NotAllowed("team.update");
			const id = await teamIdOf(tx, pk);
			const last = await tx.teamPush.findFirst({
				where: { teamId: id },
				orderBy: { id: "desc" },
			});
			if (last && last.newSha === input.newSha) return toPush(last);
			return toPush(
				await tx.teamPush.create({ data: { teamId: id, ...input } }),
			);
		},
	});

	/// The id of the team `pk` names, for the server only.
	const systemTeamId = op({
		transaction: false,
		args: [teamPK],
		run: async (
			tx: PrismaTx,
			pk: TeamPK,
			opts: ServiceOptsWithoutTx,
		): Promise<number> => {
			if (opts.actor !== SYSTEM) throw new NotAllowed("team.update");
			return teamIdOf(tx, pk);
		},
	});

	/// The write half of `reconcile`.
	const recordMain = op({
		run: async (
			tx: PrismaTx,
			teamId: number,
			main: string,
			readAt: Date,
			opts: ServiceOptsWithoutTx,
		): Promise<void> => {
			rejectExpectedUpdatedAt(opts);
			const team = await tx.team.findUnique({
				where: { id: teamId },
				select: { baseSha: true },
			});
			if (!team) return;
			const last = await tx.teamPush.findFirst({
				where: { teamId },
				orderBy: { id: "desc" },
			});
			const known = last?.newSha ?? team.baseSha;
			if (main === known) return;
			// A push recorded after `main` was read is newer than what was read.
			if (last && last.createdAt > readAt) return;
			await tx.teamPush.create({
				data: { teamId, username: null, oldSha: known, newSha: main },
			});
		},
	});

	/**
	 * Records the push that is missing when the `main` of the repository is not
	 * the last recorded one (or the template commit, for a team with no push),
	 * with no author. Concurrent calls record one push between them.
	 *
	 * @throws {@link NotAllowed} `team.update` unless the actor is `SYSTEM`.
	 * @throws {@link NotFound} If the team does not exist.
	 */
	async function reconcile(pk: TeamPK, opts: ServiceOpts): Promise<void> {
		const id = await direct(opts, (tx, scoped) => systemTeamId(tx, pk, scoped));
		const readAt = new Date();
		const main = await disk.readMain(id);
		if (main === null) return;
		await inTx(client, opts, (tx, scoped) =>
			recordMain(tx, id, main, readAt, scoped),
		);
	}

	//
	// Reading
	//

	/// The write-free half of `missingFiles`: who may read, and what is required.
	const requiredFiles = op({
		transaction: false,
		args: [teamPK],
		run: async (
			tx: PrismaTx,
			pk: TeamPK,
			opts: ServiceOptsWithoutTx,
		): Promise<{ teamId: number; required: string[] }> => {
			const team = await findTeam(tx, pk, opts.actor);
			const course = team.assignment.course;
			const actor = opts.actor;
			const member =
				actor !== SYSTEM &&
				team.members.some((row) => row.username === actor.username);
			if (!hasPerm(opts.actor, "course.read-contents", course)) {
				throw new NotFound("team");
			}
			if (!member && !hasPerm(opts.actor, "enrollment.manage", course)) {
				throw new NotFound("team");
			}
			const restrictions = restrictionsOf(team.assignment);
			return { teamId: team.id, required: restrictions?.require ?? [] };
		},
	});

	/**
	 * The paths the assignment requires that the team's `main` lacks, in the
	 * order the assignment lists them. A missing file never blocks a push.
	 *
	 * @throws {@link NotFound} If the team does not exist, or the actor is
	 * neither a member nor allowed `enrollment.manage`.
	 */
	async function missingFiles(
		pk: TeamPK,
		opts: ServiceOpts,
	): Promise<string[]> {
		const { teamId, required } = await direct(opts, (tx, scoped) =>
			requiredFiles(tx, pk, scoped),
		);
		if (required.length === 0) return checked(teamMissingFiles, [], opts);
		const main = await disk.readMain(teamId);
		const present = new Set(main ? await disk.listPaths(teamId, main) : []);
		return checked(
			teamMissingFiles,
			required.filter((path) => !present.has(path)),
			opts,
		);
	}

	/**
	 * Resolves the token and slug of a clone URL, with no actor: the token is
	 * the credential.
	 *
	 * Takes the permanent token of a member or their temporary one. Returns
	 * `null` when the token matches no member, is a temporary one that has
	 * expired, belongs to a team of an assignment with another slug, or either
	 * is malformed. A member whose enrollment is not active still resolves,
	 * with `enrolled` false.
	 */
	async function findByToken(
		token: string,
		slug: string,
		opts: Pick<ServiceOpts, "tx"> = {},
	): Promise<TeamAccess | null> {
		if (!TOKEN_PATTERN.test(token) || !slug) return null;
		const reader = opts.tx ?? client;
		const row = await reader.teamMember.findFirst({
			where: {
				OR: [
					{ token },
					{ tempToken: token, tempTokenExpiresAt: { gt: new Date() } },
				],
			},
			select: {
				username: true,
				user: { select: { name: true } },
				team: {
					select: {
						id: true,
						publicId: true,
						name: true,
						dueAt: true,
						baseSha: true,
						assignment: {
							select: {
								id: true,
								slug: true,
								courseId: true,
								opensAt: true,
								dueAt: true,
								closesAt: true,
								restrictions: true,
							},
						},
					},
				},
			},
		});
		if (!row || row.team.assignment.slug !== slug) return null;
		const { assignment } = row.team;
		const enrollment = await reader.enrollment.findUnique({
			where: {
				username_courseId: {
					username: row.username,
					courseId: assignment.courseId as CourseId,
				},
			},
			select: { status: true },
		});
		return {
			member: { username: row.username, name: row.user.name },
			team: {
				id: row.team.id as TeamId,
				publicId: row.team.publicId,
				name: row.team.name,
				dueAt: row.team.dueAt ?? assignment.dueAt,
				baseSha: row.team.baseSha,
			},
			assignment: {
				id: assignment.id,
				slug: assignment.slug,
				courseId: assignment.courseId,
				opensAt: assignment.opensAt,
				dueAt: assignment.dueAt,
				closesAt: assignment.closesAt,
				restrictions: restrictionsOf(assignment),
			},
			enrolled: enrollment?.status === "ACTIVE",
		};
	}

	/**
	 * The team with `publicId` of the assignment `slug` of a course, for an
	 * actor who manages the course.
	 *
	 * Returns `null` for anyone else, so a caller cannot tell a team that
	 * does not exist from one it may not read.
	 */
	async function findForManager(
		input: {
			course: Extract<AssignmentPK, { course: unknown }>["course"];
			slug: string;
			publicId: string;
		},
		opts: ServiceOpts,
	): Promise<{ id: TeamId; publicId: string } | null> {
		const reader = opts.tx ?? client;
		const assignment = await findAssignment(
			reader,
			{ course: input.course, slug: input.slug },
			opts.actor,
		);
		if (!assignment) return null;
		if (
			!hasPerm(opts.actor, "course.read-contents", assignment.course) ||
			!hasPerm(opts.actor, "enrollment.manage", assignment.course)
		) {
			return null;
		}
		const team = await reader.team.findFirst({
			where: { publicId: input.publicId, assignmentId: assignment.id },
			select: { id: true, publicId: true },
		});
		return team ? { id: team.id as TeamId, publicId: team.publicId } : null;
	}

	/**
	 * The team with `publicId` of the assignment `slug` of a course, for a
	 * caller that edits it as the instructor.
	 *
	 * @throws {@link NotFound} If the assignment or the team does not exist
	 * in it, or the actor cannot read the course.
	 * @throws {@link NotAllowed} `team.update` if the actor lacks `enrollment.manage`.
	 */
	async function locate(
		input: {
			course: Extract<AssignmentPK, { course: unknown }>["course"];
			slug: string;
			publicId: string;
		},
		opts: ServiceOpts,
	): Promise<{ id: TeamId; publicId: string }> {
		const reader = opts.tx ?? client;
		const assignment = await findAssignment(
			reader,
			{ course: input.course, slug: input.slug },
			opts.actor,
		);
		if (!assignment) throw new NotFound("assignment");
		managed(assignment.course, opts.actor, "team.update");
		const team = await reader.team.findFirst({
			where: { publicId: input.publicId, assignmentId: assignment.id },
			select: { id: true, publicId: true },
		});
		if (!team) throw new NotFound("team");
		return { id: team.id as TeamId, publicId: team.publicId };
	}

	const crud = defineService()(() => ({
		join,
		rotateToken,
		createTempToken,
		revokeTempToken,
		findMine,
		addMember,
		removeMember,
		setDueAt,
		rename,
		listWithDeliveries,
		summary,
		pushCounts,
		recordPush,
	}))(client);

	return {
		...crud,
		create,
		createFor,
		leave,
		remove,
		reconcile,
		missingFiles,
		findByToken,
		findForManager,
		locate,
	};
}

/** The team service, as built by {@link makeTeamService}. */
export type TeamService = ReturnType<typeof makeTeamService>;

//
// Private utilities -------------------------------------------------------
//

/// Clone tokens are 24 random bytes in base64url.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/// Join codes: no 0, O, 1 or I, so a code read aloud or from a screen is not misread.
const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const JOIN_CODE_LENGTH = 8;

/// Blobs looked up per query, below SQLite's limit on variables.
const BLOB_BATCH = 500;

/// What every read of a team loads: its members with their names.
const MEMBERS_INCLUDE = {
	members: {
		include: { user: { select: { name: true } } },
		orderBy: [{ joinedAt: "asc" }, { username: "asc" }],
	},
} satisfies Prisma.TeamInclude;

/// What a read of one team loads: the members, and the assignment for `actor`.
function teamInclude(actor: Actor) {
	return {
		...MEMBERS_INCLUDE,
		assignment: { include: assignmentInclude(actor) },
	} satisfies Prisma.TeamInclude;
}

type DbTeam = Prisma.TeamGetPayload<{
	include: ReturnType<typeof teamInclude>;
}>;

/// The team `pk` names, whether or not `actor` may see it.
async function findTeam(
	tx: PrismaTx,
	pk: TeamPK,
	actor: Actor,
): Promise<DbTeam> {
	const row = await tx.team.findFirst({
		where: "id" in pk ? { id: pk.id } : { publicId: pk.publicId },
		include: teamInclude(actor),
	});
	if (!row) throw new NotFound("team");
	return row;
}

/// The id of the team `pk` names.
async function teamIdOf(tx: PrismaTx, pk: TeamPK): Promise<number> {
	const row = await tx.team.findFirst({
		where: "id" in pk ? { id: pk.id } : { publicId: pk.publicId },
		select: { id: true },
	});
	if (!row) throw new NotFound("team");
	return row.id;
}

/**
 * The username of `actor` when it is a student of the assignment's course
 * with an active enrollment.
 *
 * @throws {@link NotAllowed} Otherwise.
 */
function studentOf(
	assignment: DbAssignment,
	actor: Actor,
	action: "team.create" | "team.update",
): string {
	if (!isEnrolledStudent(assignment, actor)) throw new NotAllowed(action);
	return (actor as UserActor).username;
}

/// Refuses a change the students make once teams are locked.
function ensureOpen(
	assignment: Parameters<typeof teamsAreLocked>[0],
	action: "team.create" | "team.update",
): void {
	if (teamsAreLocked(assignment)) throw new NotAllowed(action);
}

/**
 * Whether `actor` manages the enrollments of `course`.
 *
 * @throws {@link NotFound} If the actor cannot even read the course.
 * @throws {@link NotAllowed} If it reads the course but does not manage it.
 */
function managed(
	course: CourseWithEnrollment,
	actor: Actor,
	action: "team.create" | "team.update" | "team.delete" | "team.read",
): void {
	if (!hasPerm(actor, "course.read-contents", course)) {
		throw new NotFound("team");
	}
	if (!hasPerm(actor, "enrollment.manage", course)) {
		throw new NotAllowed(action);
	}
}

/**
 * The team of the student `actor` and their username.
 *
 * @throws {@link NotFound} If the team does not exist, the actor is not a
 * member, or cannot read the course any more.
 */
async function ownTeam(
	tx: PrismaTx,
	pk: TeamPK,
	actor: Actor,
): Promise<{ team: DbTeam; student: string }> {
	const team = await findTeam(tx, pk, actor);
	if (
		actor === SYSTEM ||
		!team.members.some((member) => member.username === actor.username) ||
		!hasPerm(actor, "course.read-contents", team.assignment.course)
	) {
		throw new NotFound("team");
	}
	return { team, student: actor.username };
}

/// The refusal of an operation that only makes sense for teams.
function individualRefusal(): InvalidData {
	return new InvalidData({
		$: [{ code: "invalid", message: m.errors_team_individual() }],
	});
}

/// Refuses a student who already belongs to a team of the assignment.
async function ensureNotInTeam(
	tx: PrismaTx,
	assignmentId: number,
	student: string,
): Promise<void> {
	const member = await tx.teamMember.findUnique({
		where: { assignmentId_username: { assignmentId, username: student } },
		select: { teamId: true },
	});
	if (member) {
		throw new InvalidData({
			$: [{ code: "not-unique", message: m.errors_team_already_member() }],
		});
	}
}

/// Refuses a name another team of the assignment already has.
async function ensureNameFree(
	tx: PrismaTx,
	assignmentId: number,
	name: string,
	except: number | null,
): Promise<void> {
	const taken = await tx.team.findUnique({
		where: { assignmentId_name: { assignmentId, name } },
		select: { id: true },
	});
	if (taken && taken.id !== except) {
		throw new InvalidData({
			name: [{ code: "not-unique", message: m.errors_team_name_taken() }],
		});
	}
}

/// Refuses a username with no active enrollment in the course.
async function ensureEnrolled(
	tx: PrismaTx,
	courseId: number,
	usernames: string[],
): Promise<void> {
	if (usernames.length === 0) return;
	const rows = await tx.enrollment.findMany({
		where: { courseId, status: "ACTIVE", username: { in: usernames } },
		select: { username: true },
	});
	const enrolled = new Set(rows.map((row) => row.username));
	const missing = usernames.filter((name) => !enrolled.has(name));
	if (missing.length > 0) {
		throw new InvalidData({
			members: missing.map(() => ({
				code: "not-exists" as const,
				message: m.errors_team_student_not_enrolled(),
			})),
		});
	}
}

/// A join code no team has yet.
async function freshJoinCode(tx: PrismaTx): Promise<string> {
	for (let attempt = 0; attempt < 10; attempt++) {
		let code = "";
		for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
			code += JOIN_CODE_ALPHABET[randomInt(JOIN_CODE_ALPHABET.length)];
		}
		const taken = await tx.team.findUnique({
			where: { joinCode: code },
			select: { id: true },
		});
		if (!taken) return code;
	}
	throw new Error("Could not generate a free join code");
}

/// The size of a team against the range its assignment asks for.
function sizeException(
	size: number,
	range: { teamMin: number; teamMax: number },
): TeamListed["sizeException"] {
	if (size === 0) return "empty";
	if (size < range.teamMin) return "below";
	if (size > range.teamMax) return "above";
	return null;
}

//
// Read models
//

type TeamRow = Prisma.TeamGetPayload<{ include: typeof MEMBERS_INCLUDE }> & {
	assignment: { dueAt: Date };
};

function toPush(row: {
	id: number;
	teamId: number;
	username: string | null;
	oldSha: string | null;
	newSha: string;
	createdAt: Date;
}): TeamPush {
	return {
		id: row.id,
		teamId: row.teamId as TeamId,
		username: row.username,
		oldSha: row.oldSha,
		newSha: row.newSha,
		createdAt: row.createdAt,
	};
}

/// The team as the instructor sees it. Reads no token.
function toTeam(row: TeamRow): Team {
	return {
		id: row.id as TeamId,
		publicId: row.publicId,
		assignmentId: row.assignmentId as AssignmentId,
		name: row.name,
		dueAt: row.dueAt ?? row.assignment.dueAt,
		extended: row.dueAt !== null,
		baseSha: row.baseSha,
		members: row.members.map((member) => ({
			username: member.username,
			name: member.user.name,
			joinedAt: member.joinedAt,
		})),
		createdAt: row.createdAt,
	};
}

/// The pushes of the teams `where` selects, grouped by team, newest first.
async function pushesOf(
	tx: PrismaTx,
	scope: { assignmentId: number } | { teamId: number },
): Promise<Map<number, TeamPush[]>> {
	const rows = await tx.teamPush.findMany({
		where: "teamId" in scope ? scope : { team: scope },
		orderBy: [{ createdAt: "desc" }, { id: "desc" }],
	});
	const byTeam = new Map<number, TeamPush[]>();
	for (const row of rows) {
		const list = byTeam.get(row.teamId) ?? [];
		list.push(toPush(row));
		byTeam.set(row.teamId, list);
	}
	return byTeam;
}

/// The team as its member `student` sees it: their own tokens and the join code.
async function toMine(
	tx: PrismaTx,
	row: DbTeam,
	student: string,
	publicUrl: string,
): Promise<TeamMine> {
	const member = row.members.find((m) => m.username === student);
	if (!member) throw new NotFound("team");
	const pushes = (await pushesOf(tx, { teamId: row.id })).get(row.id) ?? [];
	const team = toTeam(row);
	const cloneUrl = (token: string) =>
		`${publicUrl}/git/${token}/${row.assignment.slug}.git`;
	const temp =
		member.tempToken &&
		member.tempTokenExpiresAt &&
		member.tempTokenExpiresAt > new Date()
			? { token: member.tempToken, expiresAt: member.tempTokenExpiresAt }
			: null;
	return {
		...team,
		joinCode: teamsAreLocked(row.assignment) ? null : row.joinCode,
		token: member.token,
		cloneUrl: cloneUrl(member.token),
		tempCloneUrl: temp ? cloneUrl(temp.token) : null,
		tempTokenExpiresAt: temp?.expiresAt ?? null,
		pushes,
		delivery: teamDelivery(pushes, team.dueAt),
		checkpoints: checkpointDeliveries(pushes, checkpointsOf(row.assignment)),
	};
}

/// Applies the output schema of an operation that is not built by `op()`.
function checked<S extends z.ZodType>(
	schema: S,
	value: z.infer<S>,
	opts: ServiceOpts,
): z.infer<S> {
	if (opts.validate === "none" || opts.validate === "input") return value;
	return InvalidData.zodValidate(schema.safeParse(value)) as z.infer<S>;
}

//
// Template
//

/// The objects of a template repository, to seed a team repository from.
type TemplateSeed = {
	head: string;
	/// Every commit and tree of the template's history.
	objects: { kind: GitObjectKind; body: Buffer }[];
	/// Every file of that history, as the sha1 git names it and the sha-256 on disk.
	blobs: { gitSha: string; hash: string }[];
};

/**
 * Reads the whole history of the template's head: commits, trees and the
 * blobs they name. A template with no commit gives `null`.
 *
 * The files stay on disk; the seed reads them when the folder is built.
 */
async function templateSeed(
	tx: PrismaTx,
	template: { id: number; head: string | null } | null,
): Promise<TemplateSeed | null> {
	if (!template?.head) return null;
	const rows = await tx.gitObject.findMany({
		where: { repositoryId: template.id },
	});
	const objects: TemplateSeed["objects"] = [];
	const shas = new Set<string>();
	for (const row of rows) {
		const body = Buffer.from(row.content);
		if (row.type === "COMMIT") {
			objects.push({ kind: "commit", body });
			continue;
		}
		objects.push({ kind: "tree", body });
		for (const entry of parseTree(body)) {
			if (entry.mode !== "40000") shas.add(entry.sha);
		}
	}

	const wanted = [...shas];
	const hashes = new Map<string, string>();
	for (let from = 0; from < wanted.length; from += BLOB_BATCH) {
		const blobs = await tx.blob.findMany({
			where: {
				gitSha: { in: wanted.slice(from, from + BLOB_BATCH) },
				deletedAt: null,
				attachments: {
					some: { attachedToType: "REPOSITORY", attachedToId: template.id },
				},
			},
			select: { hash: true, gitSha: true },
		});
		for (const blob of blobs) {
			if (blob.gitSha && !hashes.has(blob.gitSha)) {
				hashes.set(blob.gitSha, blob.hash);
			}
		}
	}
	const missing = wanted.filter((sha) => !hashes.has(sha));
	if (missing.length > 0) {
		throw new Error(
			`The template repository ${template.id} lacks the blobs ${missing.join(", ")}`,
		);
	}
	return {
		head: template.head,
		objects,
		blobs: wanted.map((gitSha) => ({
			gitSha,
			hash: hashes.get(gitSha) as string,
		})),
	};
}

/// The seed the bare repository is built from, reading each file as it is written.
function seedFrom(
	seed: TemplateSeed,
	store: Pick<BlobService, "blobPath">,
): bare.RepositorySeed {
	return {
		head: seed.head,
		objects: (async function* () {
			yield* seed.objects;
			for (const blob of seed.blobs) {
				yield {
					kind: "blob" as const,
					body: await readFile(store.blobPath(blob.hash)),
				};
			}
		})(),
	};
}
