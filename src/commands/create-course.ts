import { input } from "@inquirer/prompts";
import { Command } from "commander";
import { FULL_ACCESS } from "@/core/actor";
import { courseService } from "@/db/services/course.service";
import { disciplineService } from "@/db/services/discipline.service";
import { userService } from "@/db/services/user.service";

export const createCourseCommand = new Command("create-course")
	.description(
		"Create a course, creating its discipline if it does not exist yet",
	)
	.argument("<discipline-slug>", "discipline slug, e.g. cs101")
	.argument("<instructor>", "the instructor's username")
	.argument("<edition>", "e.g. 2026 or 2026-1")
	.action(
		async (disciplineSlug: string, instructor: string, edition: string) => {
			const instructorUser = await userService.findOne(
				{ username: instructor },
				FULL_ACCESS,
			);
			if (!instructorUser) {
				console.error(`No user with username "${instructor}".`);
				process.exitCode = 1;
				return;
			}

			const discipline = (
				await disciplineService.findMany({ slugs: [disciplineSlug] })
			)[0];
			if (!discipline) {
				const name = await input({
					message: `Discipline "${disciplineSlug}" does not exist yet. Name:`,
				});
				try {
					await disciplineService.create(
						{ slug: disciplineSlug, name },
						FULL_ACCESS,
					);
				} catch (error) {
					console.error(error instanceof Error ? error.message : error);
					process.exitCode = 1;
					return;
				}
				console.log(`Created discipline "${disciplineSlug}".`);
			}

			const description = await input({
				message: "Description (optional):",
			});
			const startAtRaw = await input({ message: "Start date (YYYY-MM-DD):" });
			const endAtRaw = await input({ message: "End date (YYYY-MM-DD):" });
			const startAt = new Date(startAtRaw);
			const endAt = new Date(endAtRaw);
			if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
				console.error("Start and end dates must be valid dates (YYYY-MM-DD).");
				process.exitCode = 1;
				return;
			}

			try {
				const course = await courseService.create(
					{
						disciplineSlug,
						instructorUsername: instructor,
						editionSlug: edition,
						description: description || undefined,
						startAt,
						endAt,
					},
					FULL_ACCESS,
				);
				console.log(
					`Created course ${disciplineSlug}/${instructor}_${edition} (id=${course.id}).`,
				);
			} catch (error) {
				console.error(error instanceof Error ? error.message : error);
				process.exitCode = 1;
			}
		},
	);
