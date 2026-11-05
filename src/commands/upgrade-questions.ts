import { Command } from "commander";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";

export const upgradeQuestionsCommand = new Command("upgrade-questions")
	.description(
		"Rewrite question versions stored by Codehood 0.2 in the current format",
	)
	.option("--dry-run", "report what would change without writing")
	.action(async (options: { dryRun?: boolean }) => {
		const report = await db.question.upgradeLegacyVersions(
			{ dryRun: options.dryRun },
			FULL_ACCESS,
		);
		const verb = options.dryRun ? "Would upgrade" : "Upgraded";
		console.log(
			`${verb} ${report.upgraded} version(s); ${report.current} already current.`,
		);
		for (const failure of report.failed) {
			console.error(
				`Failed ${failure.slug} (#${failure.id}): ${failure.reason}`,
			);
		}
		if (report.failed.length > 0) process.exitCode = 1;
	});
