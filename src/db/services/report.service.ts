/**
 * Users' reports of problems with Codehood or with a course's material.
 *
 * One message, no replies. The author sees the status only; the admin triages
 * every report and a course's instructor the `CONTENT` reports of that course.
 */
import { randomBytes } from "node:crypto";
import type { z } from "zod";
import { type Actor, SYSTEM } from "@/auth/actor";
import { ensurePerm, hasPerm, type ReportTarget } from "@/auth/permissions";
import {
	InvalidData,
	NotAllowed,
	NotFound,
	NotImplemented,
	TooManyRequests,
} from "@/core/error";
import {
	type CourseId,
	type CourseRef,
	REPORT_DAILY_LIMIT,
	REPORT_MAX_ATTACHMENT_BYTES,
	type ReportId,
	reportCreate,
	reportFilter,
	reportPK,
	reportSchema,
	reportUpdate,
} from "@/core/schemas";
import {
	CrudBase,
	type ServiceOpts,
	type ServiceOptsWithoutTx,
} from "@/db/base-service";
import { m } from "@/i18n";
import { sanitizeFilename } from "@/utils/filename";
import { extensionOf } from "@/utils/mime";
import { Validate } from "@/utils/validate";
import {
	type Prisma,
	type PrismaClient,
	type PrismaTx,
	prisma,
} from "../client";
import { courseRefMatch } from "../utils";
import type { AttachmentService } from "./attachment.service";
import type { BlobService } from "./blob.service";

export type { ReportId } from "@/core/schemas";

//
// Type definitions
//
export type Report = z.infer<typeof reportSchema>;
export type ReportCreate = z.infer<typeof reportCreate>;
export type ReportFilter = z.infer<typeof reportFilter>;
export type ReportPK = z.infer<typeof reportPK>;
export type ReportUpdate = z.infer<typeof reportUpdate>;

/// The extensions a report attachment may have.
const ATTACHMENT_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

/// How long, in milliseconds, the daily report limit looks back.
const DAY_MS = 24 * 60 * 60 * 1000;

const reportInclude = {
	course: {
		select: {
			id: true,
			disciplineSlug: true,
			instructorId: true,
			editionSlug: true,
		},
	},
} satisfies Prisma.ReportInclude;

type DbReport = Prisma.ReportGetPayload<{ include: typeof reportInclude }>;

type DbAttachment = Prisma.AttachmentGetPayload<{
	include: { blob: { select: { size: true } } };
}>;

export class ReportService extends CrudBase<{
	entity: Report;
	pkFilter: ReportPK;
	create: ReportCreate;
	filter: ReportFilter;
	update: ReportUpdate;
	upsert: false;
}> {
	private readonly attachments: AttachmentService;
	private readonly blob: BlobService;

	constructor(
		attachments: AttachmentService,
		blob: BlobService,
		client: PrismaClient = prisma,
	) {
		super(client);
		this.attachments = attachments;
		this.blob = blob;
	}

	/**
	 * Opens a report authored by the actor, `OPEN`, with its attachments stored in the same transaction.
	 *
	 * Attachment names are sanitised; a name that clashes with an earlier one
	 * gets a numeric suffix (`image.png`, `image-2.png`).
	 *
	 * @throws {@link TooManyRequests}
	 * If the author already sent `REPORT_DAILY_LIMIT` reports in the last 24 hours.
	 * @throws {@link InvalidData}
	 * If an attachment is not a `.png`, `.jpg`, `.jpeg` or `.webp`, or is larger
	 * than `REPORT_MAX_ATTACHMENT_BYTES`.
	 * @throws {@link NotFound}
	 * If `input.course` does not exist.
	 * @throws {@link NotAllowed}
	 * If the actor is `SYSTEM`, which has no username to author a report.
	 */
	@Validate({
		service: true,
		returns: reportSchema,
		args: [undefined, reportCreate],
	})
	protected override async createTx(
		tx: PrismaTx,
		input: ReportCreate,
		opts: ServiceOptsWithoutTx,
	): Promise<Report> {
		const actor = opts.actor;
		if (actor === SYSTEM || !hasPerm(actor, "report.create")) {
			throw new NotAllowed("report.create");
		}
		const files = reportAttachmentFiles(input.attachments ?? []);

		const recent = await tx.report.count({
			where: {
				authorId: actor.username,
				createdAt: { gte: new Date(Date.now() - DAY_MS) },
			},
		});
		if (recent >= REPORT_DAILY_LIMIT) throw new TooManyRequests();

		let courseId: CourseId | null = null;
		if (input.course != null) {
			const course = await tx.course.findUnique({
				where: courseWhere(input.course),
				select: { id: true },
			});
			if (!course) throw new NotFound("course");
			courseId = course.id;
		}

		const row = await tx.report.create({
			data: {
				publicId: randomBytes(9).toString("hex"),
				kind: input.kind,
				message: input.message,
				url: input.url ?? null,
				userAgent: input.userAgent ?? null,
				viewport: input.viewport ?? null,
				authorId: actor.username,
				courseId,
			},
			include: reportInclude,
		});

		for (const file of files) {
			await this.attachments.create(
				{
					filename: file.filename,
					buffer: file.bytes,
					attachedTo: { type: "REPORT", id: row.id as ReportId },
				},
				{ ...opts, tx },
			);
		}

		return this.toReport(tx, row, actor);
	}

	/**
	 * Finds a report by its `publicId`; `null` if it does not exist or the actor may not read it.
	 *
	 * The triage `note` is left out for an actor who reads it only as its author.
	 */
	@Validate({
		service: true,
		returns: reportSchema.nullable(),
		args: [undefined, reportPK],
	})
	protected override async findOneTx(
		tx: PrismaTx,
		pk: ReportPK,
		opts: ServiceOptsWithoutTx,
	): Promise<Report | null> {
		const row = await tx.report.findUnique({
			where: { publicId: pk.publicId },
			include: reportInclude,
		});
		if (!row || !hasPerm(opts.actor, "report.read", targetOf(row))) {
			return null;
		}
		return this.toReport(tx, row, opts.actor);
	}

	/**
	 * Finds the reports matching `filter` that the actor may read, oldest first.
	 *
	 * The query already narrows to what the actor may read; each row is then
	 * checked against `report.read`. An empty `status` or `kind` list does not filter.
	 */
	@Validate({
		service: true,
		returns: reportSchema.array(),
		args: [undefined, reportFilter],
	})
	protected override async findManyTx(
		tx: PrismaTx,
		filter: ReportFilter,
		opts: ServiceOptsWithoutTx,
	): Promise<Report[]> {
		const rows = await tx.report.findMany({
			where: {
				AND: [
					visibleWhere(opts.actor),
					filter.status?.length ? { status: { in: filter.status } } : {},
					filter.kind?.length ? { kind: { in: filter.kind } } : {},
					filter.course != null
						? { course: courseRefMatch(filter.course) }
						: {},
					filter.author ? { authorId: filter.author } : {},
				],
			},
			include: reportInclude,
			orderBy: [{ createdAt: "asc" }, { id: "asc" }],
		});
		const readable = rows.filter((row) =>
			hasPerm(opts.actor, "report.read", targetOf(row)),
		);
		return Promise.all(
			readable.map((row) => this.toReport(tx, row, opts.actor)),
		);
	}

	/**
	 * Triages a report: changes its status, kind or note.
	 */
	@Validate({
		service: true,
		returns: reportSchema,
		args: [undefined, reportPK, reportUpdate],
	})
	protected override async updateTx(
		tx: PrismaTx,
		pk: ReportPK,
		input: ReportUpdate,
		opts: ServiceOptsWithoutTx,
	): Promise<Report> {
		const row = await this.readableRow(tx, pk, opts.actor);
		ensurePerm(opts.actor, "report.triage", targetOf(row));

		const kind = input.kind ?? row.kind;
		if (kind === "CONTENT" && row.courseId === null) {
			throw new InvalidData({
				kind: [
					{ code: "invalid", message: m.forms_schema_report_course_required() },
				],
			});
		}

		const data: Prisma.ReportUncheckedUpdateInput = { kind };
		if (input.note !== undefined) data.note = input.note;
		if (input.status != null && input.status !== row.status) {
			data.status = input.status;
			const actor = opts.actor;
			const reopened = input.status === "OPEN";
			data.triagedById = reopened || actor === SYSTEM ? null : actor.username;
			data.triagedAt = reopened ? null : new Date();
		}

		const updated = await tx.report.update({
			where: { id: row.id },
			data,
			include: reportInclude,
		});
		return this.toReport(tx, updated, opts.actor);
	}

	/**
	 * Deletes a report and releases its attachments.
	 *
	 * @throws {@link NotFound} If the report does not exist or the actor may not read it.
	 * @throws {@link NotAllowed} If the actor may read it but not delete it.
	 */
	@Validate({ service: true, args: [undefined, reportPK] })
	protected override async deleteTx(
		tx: PrismaTx,
		pk: ReportPK,
		opts: ServiceOptsWithoutTx,
	): Promise<void> {
		const row = await this.readableRow(tx, pk, opts.actor);
		ensurePerm(opts.actor, "report.delete", targetOf(row));
		await this.attachments.detach("REPORT", row.id, { ...opts, tx });
		await tx.report.delete({ where: { id: row.id } });
	}

	/// No upsert: a report is sent once, with `create`.
	override upsert<Opt extends ServiceOpts>(
		_input: never,
		_opts: Opt,
	): Promise<never> {
		throw new NotImplemented("report.upsert");
	}

	/**
	 * The bytes and mime type of the attachment `filename` of a report.
	 *
	 * Readable by whoever may read the report.
	 *
	 * @throws {@link NotFound}
	 * If the report does not exist or the actor may not read it, or it has no
	 * attachment called `filename`.
	 */
	async attachment(
		pk: ReportPK,
		filename: string,
		opts: ServiceOpts,
	): Promise<{ bytes: Buffer; mimeType: string; filename: string }> {
		const client = opts.tx ?? this.prisma;
		const report = await client.report.findUnique({
			where: { publicId: pk.publicId },
			include: reportInclude,
		});
		if (!report || !hasPerm(opts.actor, "report.read", targetOf(report))) {
			throw new NotFound("report", pk.publicId);
		}
		const row = await client.attachment.findFirst({
			where: {
				attachedToType: "REPORT",
				attachedToId: report.id,
				filename,
			},
			include: { blob: true },
		});
		const bytes = row && (await this.blob.readBlob(row.blob));
		if (!row || !bytes) throw new NotFound("attachment", filename);
		return { bytes, mimeType: row.mimeType, filename: row.filename };
	}

	/**
	 * How many `OPEN` `CONTENT` reports of `course` the actor may read.
	 */
	async countOpen(course: CourseRef, opts: ServiceOpts): Promise<number> {
		const client = opts.tx ?? this.prisma;
		return client.report.count({
			where: {
				AND: [
					visibleWhere(opts.actor),
					{
						status: "OPEN",
						kind: "CONTENT",
						course: courseRefMatch(course),
					},
				],
			},
		});
	}

	/// The report `pk`, or `NotFound` when it does not exist or `actor` may not read it.
	private async readableRow(
		tx: PrismaTx,
		pk: ReportPK,
		actor: Actor,
	): Promise<DbReport> {
		const row = await tx.report.findUnique({
			where: { publicId: pk.publicId },
			include: reportInclude,
		});
		if (!row || !hasPerm(actor, "report.read", targetOf(row))) {
			throw new NotFound("report", pk.publicId);
		}
		return row;
	}

	/// The public shape of `row`, with its attachments, hiding the note from a reader who is only the author.
	private async toReport(
		tx: PrismaTx | PrismaClient,
		row: DbReport,
		actor: Actor,
	): Promise<Report> {
		const attachments = await tx.attachment.findMany({
			where: { attachedToType: "REPORT", attachedToId: row.id },
			include: { blob: { select: { size: true } } },
			orderBy: { id: "asc" },
		});
		const triages = hasPerm(actor, "report.triage", targetOf(row));
		return {
			id: row.id as ReportId,
			publicId: row.publicId,
			kind: row.kind,
			message: row.message,
			status: row.status,
			...(triages && { note: row.note }),
			url: row.url,
			userAgent: row.userAgent,
			viewport: row.viewport,
			author: row.authorId,
			course: row.course && {
				discipline: row.course.disciplineSlug,
				instructor: row.course.instructorId,
				edition: row.course.editionSlug,
			},
			attachments: attachments.map((a) => attachmentView(row.publicId, a)),
			triagedBy: row.triagedById,
			triagedAt: row.triagedAt,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		};
	}
}

//
// Auxiliary functions
//

/// A `where` matching what `actor` may read: everything for an admin or SYSTEM, otherwise their own reports and the `CONTENT` reports of courses they teach.
function visibleWhere(actor: Actor): Prisma.ReportWhereInput {
	if (actor === SYSTEM || actor.role === "ADMIN") return {};
	return {
		OR: [
			{ authorId: actor.username },
			{ kind: "CONTENT", course: { instructorId: actor.username } },
		],
	};
}

/// The permission target of a report row.
function targetOf(row: DbReport): ReportTarget {
	return {
		id: row.id,
		kind: row.kind,
		status: row.status,
		author: { username: row.authorId },
		course: row.course
			? { id: row.course.id, instructor: { username: row.course.instructorId } }
			: null,
	};
}

/// The `where` matching the course `ref`, by id or natural key.
function courseWhere(ref: CourseRef): Prisma.CourseWhereUniqueInput {
	if (typeof ref === "number") return { id: ref };
	return {
		disciplineSlug_instructorId_editionSlug: {
			disciplineSlug: ref.discipline,
			instructorId: ref.instructor,
			editionSlug: ref.edition,
		},
	};
}

/// What a report shows of one of its attachments; never the blob hash.
function attachmentView(publicId: string, row: DbAttachment) {
	return {
		filename: row.filename,
		mimeType: row.mimeType,
		size: row.blob.size,
		url: `/api/report/${publicId}/attachment/${encodeURIComponent(row.filename)}`,
	};
}

/// Sanitises and checks the attachments of a new report, giving clashing names a numeric suffix.
function reportAttachmentFiles(
	files: { filename: string; bytes: Buffer }[],
): { filename: string; bytes: Buffer }[] {
	const taken = new Set<string>();
	return files.map(({ filename, bytes }) => {
		const name = sanitizeFilename(filename);
		const extension = extensionOf(name);
		if (!extension || !ATTACHMENT_EXTENSIONS.has(extension)) {
			throw new InvalidData({
				attachments: [
					{ code: "invalid", message: m.errors_report_attachment_type() },
				],
			});
		}
		if (bytes.length > REPORT_MAX_ATTACHMENT_BYTES) {
			throw new InvalidData({
				attachments: [
					{ code: "too-long", message: m.errors_report_attachment_size() },
				],
			});
		}
		const stem = name.slice(0, -extension.length);
		let unique = name;
		for (let n = 2; taken.has(unique); n++) unique = `${stem}-${n}${extension}`;
		taken.add(unique);
		return { filename: unique, bytes };
	});
}
