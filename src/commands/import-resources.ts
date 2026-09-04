import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { FULL_ACCESS } from "@/core/actor";
import { courseService } from "@/db/services/course.service";
import { fileService } from "@/db/services/file.service";
import {
	type Resource,
	type ResourceCreate,
	resourceService,
} from "@/db/services/resource.service";
import { guessMimeType } from "@/utils/mime";
import { blobHref, fileDownloadName } from "@/utils/resource-url";

const resourceEntrySchema = z.object({
	slug: z.string().min(1),
	type: z.enum(["LINK", "FILE", "MD", "CODE"]),
	title: z.string().min(1),
	description: z.string().optional(),
	data: z.string().optional(),
	extra: z.string().optional(),
	file: z.string().optional(),
});

const manifestSchema = z.object({
	resources: z.array(resourceEntrySchema),
});

type ResourceEntry = z.infer<typeof resourceEntrySchema>;

export const importResourcesCommand = new Command("import-resources")
	.description(
		"Import a course's resources from a YAML manifest, shaped like the sync payload",
	)
	.argument("<discipline-slug>", "discipline slug, e.g. cs101")
	.argument("<instructor>", "the instructor's username")
	.argument("<edition>", "e.g. 2026 or 2026-1")
	.argument("<manifest>", "path to the resources YAML file")
	.option(
		"--prune",
		"delete resources not named in the manifest (default: additive)",
	)
	.action(
		async (
			disciplineSlug: string,
			instructor: string,
			edition: string,
			manifestPath: string,
			options: { prune?: boolean },
		) => {
			const course = await courseService.findOne(
				{ ref: { disciplineSlug, username: instructor, edition } },
				FULL_ACCESS,
			);
			if (!course) {
				console.error(`No course ${disciplineSlug}/${instructor}_${edition}.`);
				process.exitCode = 1;
				return;
			}

			const manifestDir = path.dirname(path.resolve(manifestPath));
			let entries: ResourceEntry[];
			try {
				const raw = await readFile(manifestPath, "utf8");
				entries = manifestSchema.parse(parseYaml(raw)).resources;
			} catch (error) {
				console.error(error instanceof Error ? error.message : String(error));
				process.exitCode = 1;
				return;
			}

			const seenSlugs = new Set<string>();
			const createdBlobUrls: string[] = [];

			for (const entry of entries) {
				seenSlugs.add(entry.slug);
				try {
					const built = await buildCreateInput(entry, manifestDir, course.id);
					const existing = await resourceService.findOne(
						{ ref: { courseId: course.id, slug: entry.slug } },
						FULL_ACCESS,
					);
					let resource: Resource;
					if (existing) {
						resource = await resourceService.update(
							{ id: existing.id },
							built,
							FULL_ACCESS,
						);
						console.log(`Updated  ${entry.slug} (${entry.type}).`);
					} else {
						resource = await resourceService.create(
							{ ...built, courseId: course.id, slug: entry.slug },
							FULL_ACCESS,
						);
						console.log(`Created  ${entry.slug} (${entry.type}).`);
					}
					if (resource.type === "FILE" && resource.file) {
						const url = blobHref(
							resource.file,
							fileDownloadName(resource, resource.file),
						);
						createdBlobUrls.push(url);
					}
				} catch (error) {
					console.error(
						`  ✗ ${entry.slug}: ${error instanceof Error ? error.message : error}`,
					);
					process.exitCode = 1;
				}
			}

			if (options.prune) {
				const current = await resourceService.findMany(
					{ courseId: course.id },
					FULL_ACCESS,
				);
				for (const resource of current) {
					if (!seenSlugs.has(resource.slug)) {
						await resourceService.delete({ id: resource.id }, FULL_ACCESS);
						console.log(`Pruned   ${resource.slug} (${resource.type}).`);
					}
				}
			}

			if (createdBlobUrls.length > 0) {
				console.log("\nBlob URLs:");
				for (const url of createdBlobUrls) {
					console.log(`  ${url}`);
				}
			}
			console.log(
				"\nReminder: every /files/ URL is public forever, with no authentication check " +
					"(FR-NFR-030/031/032). Never point a resource at content whose disclosure matters.",
			);
		},
	);

/**
 * Builds the fields shared by `create` and `update`, computing `contentHash`
 * locally the way the CLI will: for `FILE`, the underlying blob's sha-256; for
 * everything else, a hash of the resource's own fields, since `data`/`extra`
 * carry the content the file hash would otherwise cover.
 */
async function buildCreateInput(
	entry: ResourceEntry,
	manifestDir: string,
	_courseId: number,
): Promise<Omit<ResourceCreate, "courseId" | "slug">> {
	if (entry.type === "FILE") {
		if (!entry.file) {
			throw new Error("a FILE resource needs a `file` path.");
		}
		const filePath = path.resolve(manifestDir, entry.file);
		const bytes = await readFile(filePath);
		const contentHash = createHash("sha256").update(bytes).digest("hex");
		const file = await fileService.create(
			{ bytes, mimeType: guessMimeType(filePath), contentHash },
			FULL_ACCESS,
		);
		return {
			type: entry.type,
			title: entry.title,
			description: entry.description,
			fileId: file.id,
			contentHash: resourceContentHash(entry, file.slugHash),
		};
	}
	return {
		type: entry.type,
		title: entry.title,
		description: entry.description,
		data: entry.data,
		extra: entry.extra,
		contentHash: resourceContentHash(entry),
	};
}

function resourceContentHash(entry: ResourceEntry, fileHash?: string): string {
	const canonical = JSON.stringify({
		type: entry.type,
		title: entry.title,
		description: entry.description ?? null,
		data: entry.data ?? null,
		extra: entry.extra ?? null,
		file: fileHash ?? null,
	});
	return createHash("sha256").update(canonical).digest("hex");
}
