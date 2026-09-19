import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { FULL_ACCESS } from "@/auth/actor";
import { db, type Resource, type ResourceCreate } from "@/db";

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
			const course = await db.course.findOne(
				{
					discipline: disciplineSlug,
					instructor: instructor,
					edition,
				},
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
					const built = await buildCreateInput(entry, manifestDir);
					const existing = await db.resource.findOne(
						{ courseId: course.id, slug: entry.slug },
						FULL_ACCESS,
					);
					let resource: Resource;
					if (existing) {
						resource = await db.resource.update(
							{ id: existing.id },
							built,
							FULL_ACCESS,
						);
						console.log(`Updated  ${entry.slug} (${entry.type}).`);
					} else {
						resource = await db.resource.create(
							{ ...built, courseId: course.id, slug: entry.slug },
							FULL_ACCESS,
						);
						console.log(`Created  ${entry.slug} (${entry.type}).`);
					}
					if (resource.data.type === "FILE" && resource.data.link) {
						const url = resource.data.link;
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
				const current = await db.resource.findMany(
					{ courseId: course.id },
					FULL_ACCESS,
				);
				for (const resource of current) {
					if (!seenSlugs.has(resource.slug)) {
						await db.resource.delete({ id: resource.id }, FULL_ACCESS);
						console.log(`Pruned   ${resource.slug} (${resource.data.type}).`);
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
 * Builds the fields shared by `create` and `update`, computing `ref`
 * locally the way the CLI will: for `FILE`, the raw bytes' sha-256; for
 * everything else, a hash of the resource's own fields, since `data`/`extra`
 * carry the content the file hash would otherwise cover.
 */
async function buildCreateInput(
	entry: ResourceEntry,
	manifestDir: string,
): Promise<Omit<ResourceCreate, "courseId" | "slug">> {
	if (entry.type === "FILE") {
		if (!entry.file) {
			throw new Error("a FILE resource needs a `file` path.");
		}
		const filePath = path.resolve(manifestDir, entry.file);
		const buffer = await readFile(filePath);
		const fileHash = createHash("sha256").update(buffer).digest("hex");
		return {
			title: entry.title,
			description: entry.description,
			ref: resourceContentHash(entry, fileHash),
			data: {
				type: "FILE",
				filename: path.basename(entry.file),
				buffer,
			},
		};
	}
	return {
		title: entry.title,
		description: entry.description,
		ref: resourceContentHash(entry),
		data: buildResourceData(entry),
	};
}

function buildResourceData(
	entry: ResourceEntry,
): Exclude<ResourceCreate["data"], { type: "FILE" }> {
	switch (entry.type) {
		case "LINK":
			if (!entry.data) {
				throw new Error("a LINK resource needs `data` set to its URL.");
			}
			return { type: "LINK", url: entry.data };
		case "CODE":
			if (!entry.data) {
				throw new Error("a CODE resource needs `data` set to its content.");
			}
			if (!entry.extra) {
				throw new Error("a CODE resource needs `extra` set to its language.");
			}
			return { type: "CODE", content: entry.data, language: entry.extra };
		case "MD":
			if (!entry.data) {
				throw new Error("an MD resource needs `data` set to its content.");
			}
			return { type: "MD", content: entry.data };
		default:
			throw new Error(`Unsupported type: ${entry.type}`);
	}
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
