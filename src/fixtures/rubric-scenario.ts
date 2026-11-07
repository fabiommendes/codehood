/**
 * Arrangements for grading-rubric tests: a course with an exam, questions
 * that may carry an initial rubric, answers to grade, and rubrics and
 * grading passes written straight to the database.
 *
 * Writing rubrics and passes through `prisma` keeps a test of one service
 * independent of the other: the rubric tests do not need feedback to accept
 * `rubric`, and the feedback tests do not need the rubric service.
 */
import { db, type Submission, type schema, type User } from "@/db";
import type { Prisma } from "@/db/client";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "./course.factory";
import { persistedExamFactory } from "./exam.factory";
import { persistedQuestionFactory } from "./question.factory";
import { persistedResponseFactory } from "./response.factory";
import { persistedSubmissionFactory } from "./submission.factory";
import { persistedUserFactory } from "./user.factory";

/// Random suffix: every spec file shares one database, so counters would collide.
function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

/// Addresses the rubric of one question in one exam.
export interface ScenarioRubricPK {
	course: schema.CourseId;
	exam: string;
	question: string;
}

/// One question of the scenario's exam and the key of its rubric.
export interface ScenarioQuestion {
	slug: string;
	pk: ScenarioRubricPK;
}

/// A student's answer to one question.
export interface ScenarioAnswer {
	author: User;
	response: { publicId: string };
	submission: Submission;
}

/// An item written straight to the database.
export interface SeedItem {
	key: string;
	group?: string | null;
	text?: string;
	value: string;
	comment?: string | null;
	feedback?: string | null;
	/// Marks the item as split or retired.
	retired?: boolean;
}

/// A rubric written straight to the database.
export interface SeededRubric {
	id: number;
	/// Item ids by key.
	itemIds: Record<string, number>;
}

export interface RubricScenarioOptions {
	/// The initial rubric, stored as `privatePayload.rubric` of the main question's version "1". Anything goes, malformed values included.
	rubric?: unknown;
	/// Further questions of the same exam, each with its own initial rubric.
	siblings?: { rubric?: unknown }[];
	/// The version of the main question the exam pins; `null` follows the latest.
	pin?: string | null;
}

export interface RubricScenario {
	course: { id: schema.CourseId };
	instructor: User;
	exam: { id: number; slug: string };
	/// The main question and the key of its rubric in the main exam.
	main: ScenarioQuestion;
	siblings: ScenarioQuestion[];
	/// A new student answers `question` (the main one by default).
	addAnswer(question?: string): Promise<ScenarioAnswer>;
	/// The same student answers `question` once more, in the same attempt.
	addSubmission(answer: ScenarioAnswer, question?: string): Promise<Submission>;
	/// Closes the exam to answers, without releasing grades.
	close(): Promise<void>;
	/// Closes the exam and releases its grades to the students.
	release(): Promise<void>;
	/// Another exam of the course carrying the main question, pinned to `pin`.
	addExam(pin: string | null): Promise<{ id: number; pk: ScenarioRubricPK }>;
	/// Stores a new latest version of `question` whose initial rubric is `rubric`.
	pushQuestionVersion(
		question: string,
		version: string,
		rubric: unknown,
	): Promise<void>;
	/// Rewrites the exam's question list the way an exam push does.
	repushExam(questions?: string[]): Promise<void>;
	/// Writes a rubric into the database for `question` of the main exam.
	seedRubric(input: {
		question?: string;
		base?: string;
		items: SeedItem[];
	}): Promise<SeededRubric>;
	/// Writes a grading pass that applies `keys` of `rubric` to `answer`, with `score` as given.
	seedPass(
		answer: ScenarioAnswer,
		rubric: SeededRubric,
		pass: {
			ref: string;
			keys: string[];
			score: string;
			adjustment?: string | null;
			updatedAt?: Date;
		},
	): Promise<schema.FeedbackId>;
}

/**
 * A course whose instructor owns an exam with one main question and any
 * `siblings`, none answered yet.
 *
 * The exam is `ONGOING` so students can answer; `close` and `release` move it
 * on afterwards.
 */
export async function createRubricScenario(
	options: RubricScenarioOptions = {},
): Promise<RubricScenario> {
	const instructor = await persistedUserFactory.create({ role: "INSTRUCTOR" });
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
	});
	const pin = options.pin ?? null;

	async function addQuestion(rubric: unknown): Promise<string> {
		const question = await persistedQuestionFactory.create(
			{ course: course.id, slug: tag("q-") },
			{ transient: { type: "essay" } },
		);
		if (rubric !== undefined) {
			await setInitialRubric(course.id, question.slug, "1", rubric);
		}
		return question.slug;
	}

	const mainSlug = await addQuestion(options.rubric);
	const siblingSlugs: string[] = [];
	for (const sibling of options.siblings ?? []) {
		siblingSlugs.push(await addQuestion(sibling.rubric));
	}

	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: tag("exam-"),
		type: "EXAM",
		status: "ONGOING",
		questions: [
			{ slug: mainSlug, version: pin },
			...siblingSlugs.map((slug) => ({ slug })),
		],
	});

	const pkFor = (question: string, examSlug = exam.slug): ScenarioRubricPK => ({
		course: course.id,
		exam: examSlug,
		question,
	});

	async function ref(question: string) {
		return prisma.questionRef.findFirstOrThrow({
			where: { courseId: course.id, slug: question },
		});
	}

	return {
		course,
		instructor,
		exam: { id: exam.id, slug: exam.slug },
		main: { slug: mainSlug, pk: pkFor(mainSlug) },
		siblings: siblingSlugs.map((slug) => ({ slug, pk: pkFor(slug) })),

		async addAnswer(question = mainSlug) {
			const author = await persistedUserFactory.create({ role: "STUDENT" });
			await db.enrollment.create(
				{ course: course.id, username: author.username },
				{ actor: instructor },
			);
			const response = await persistedResponseFactory.create({
				course: course.id,
				exam: exam.slug,
				author: author.username,
			});
			const submission = await persistedSubmissionFactory.create({
				response: { publicId: response.publicId },
				question,
			});
			return { author, response: { publicId: response.publicId }, submission };
		},

		async addSubmission(answer, question = mainSlug) {
			return persistedSubmissionFactory.create({
				response: { publicId: answer.response.publicId },
				question,
			});
		},

		async close() {
			await prisma.exam.update({
				where: { id: exam.id },
				data: { status: "COMPLETED" },
			});
		},

		async release() {
			await prisma.exam.update({
				where: { id: exam.id },
				data: {
					status: "COMPLETED",
					gradesReleasedAt: new Date(Date.now() - 60_000),
				},
			});
		},

		async addExam(examPin) {
			const other = await persistedExamFactory.create({
				course: course.id,
				slug: tag("exam-"),
				type: "EXAM",
				status: "ONGOING",
				questions: [{ slug: mainSlug, version: examPin }],
			});
			return { id: other.id, pk: pkFor(mainSlug, other.slug) };
		},

		async pushQuestionVersion(question, version, rubric) {
			const row = await prisma.questionRef.findFirstOrThrow({
				where: { courseId: course.id, slug: question },
				include: { latest: true },
			});
			const latest = row.latest;
			if (!latest) throw new Error(`question ${question} has no version`);
			const created = await prisma.questionData.create({
				data: {
					refId: row.id,
					versionHash: version,
					title: latest.title,
					stem: latest.stem,
					publicPayload: latest.publicPayload as Prisma.InputJsonValue,
					privatePayload: {
						...(latest.privatePayload as Record<string, unknown>),
						rubric,
					} as Prisma.InputJsonValue,
				},
			});
			await prisma.questionRef.update({
				where: { id: row.id },
				data: { latestId: created.id },
			});
		},

		async repushExam(questions) {
			const slugs = questions ?? [mainSlug, ...siblingSlugs];
			await db.exam.update(
				{ course: course.id, slug: exam.slug },
				{
					questions: slugs.map((slug) =>
						slug === mainSlug ? { slug, version: pin } : { slug },
					),
				},
				{ actor: instructor },
			);
		},

		async seedRubric({ question = mainSlug, base = "0", items }) {
			const questionRef = await ref(question);
			const row = await prisma.rubric.create({
				data: {
					examId: exam.id,
					questionRefId: questionRef.id,
					base,
					items: {
						create: items.map((item, position) => ({
							key: item.key,
							group: item.group ?? null,
							text: item.text ?? `Item ${item.key}`,
							value: item.value,
							comment: item.comment ?? null,
							feedback: item.feedback ?? null,
							position,
							retiredAt: item.retired ? new Date("2026-01-01") : null,
						})),
					},
				},
				include: { items: true },
			});
			return {
				id: row.id,
				itemIds: Object.fromEntries(row.items.map((i) => [i.key, i.id])),
			};
		},

		async seedPass(answer, rubric, pass) {
			const row = await prisma.feedback.create({
				data: {
					submissionId: answer.submission.id,
					ref: pass.ref,
					score: pass.score,
					graderId: instructor.username,
					rubricId: rubric.id,
					adjustment: pass.adjustment ?? null,
					...(pass.updatedAt ? { updatedAt: pass.updatedAt } : {}),
					rubricItems: {
						create: pass.keys.map((key) => {
							const itemId = rubric.itemIds[key];
							if (itemId === undefined)
								throw new Error(`no seeded item ${key}`);
							return { itemId };
						}),
					},
				},
			});
			return row.id as schema.FeedbackId;
		},
	};
}

/// Adds `rubric` to the private document of one stored version of a question.
async function setInitialRubric(
	courseId: number,
	slug: string,
	version: string,
	rubric: unknown,
): Promise<void> {
	const ref = await prisma.questionRef.findFirstOrThrow({
		where: { courseId, slug },
	});
	const row = await prisma.questionData.findUniqueOrThrow({
		where: { refId_versionHash: { refId: ref.id, versionHash: version } },
	});
	await prisma.questionData.update({
		where: { id: row.id },
		data: {
			privatePayload: {
				...(row.privatePayload as Record<string, unknown>),
				rubric,
			} as Prisma.InputJsonValue,
		},
	});
}

/// The score stored on a pass, read straight from the database.
export async function storedScore(
	feedbackId: schema.FeedbackId,
): Promise<string> {
	const row = await prisma.feedback.findUniqueOrThrow({
		where: { id: feedbackId },
		select: { score: true },
	});
	return row.score;
}
