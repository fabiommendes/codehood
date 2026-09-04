import { input } from "@inquirer/prompts";
import { Command } from "commander";
import { FULL_ACCESS } from "@/core/actor";
import { editionService } from "@/db/services/edition.service";

export const createEditionCommand = new Command("create-edition")
	.description("Create an academic edition (term)")
	.argument("<slug>", "e.g. 2026 or 2026-1")
	.option("-n, --name <name>", "display name, e.g. '2026 · first term'")
	.action(async (slug: string, options: { name?: string }) => {
		const name = options.name ?? (await input({ message: "Display name:" }));
		const startAtRaw = await input({
			message: "Open for new courses from (YYYY-MM-DD):",
		});
		const endAtRaw = await input({
			message: "Open for new courses until (YYYY-MM-DD):",
		});
		const startAt = new Date(startAtRaw);
		const endAt = new Date(endAtRaw);
		if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
			console.error("Start and end dates must be valid dates (YYYY-MM-DD).");
			process.exitCode = 1;
			return;
		}

		try {
			const edition = await editionService.create(
				{ slug, name, startAt, endAt },
				FULL_ACCESS,
			);
			console.log(`Created edition "${edition.slug}" (${edition.name}).`);
		} catch (error) {
			console.error(error instanceof Error ? error.message : error);
			process.exitCode = 1;
		}
	});
