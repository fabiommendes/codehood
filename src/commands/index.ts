import { Command } from "commander";
import { answerHistoryStatsCommand } from "./answer-history-stats";
import { createCourseCommand } from "./create-course";
import { createEditionCommand } from "./create-edition";
import { createUserCommand } from "./create-user";
import { importCalendarCommand } from "./import-calendar";
import { importResourcesCommand } from "./import-resources";
import { recomputeEventTimesCommand } from "./recompute-event-times";
import { resetPasswordCommand } from "./reset-password";
import { upgradeQuestionsCommand } from "./upgrade-questions";

const manage = new Command("manage").description(
	"Codehood server management commands",
);

manage.addCommand(createUserCommand);
manage.addCommand(resetPasswordCommand);
manage.addCommand(createCourseCommand);
manage.addCommand(createEditionCommand);
manage.addCommand(importResourcesCommand);
manage.addCommand(importCalendarCommand);
manage.addCommand(recomputeEventTimesCommand);
manage.addCommand(upgradeQuestionsCommand);
manage.addCommand(answerHistoryStatsCommand);

await manage.parseAsync(process.argv);
