import { Command } from "commander";
import { answerHistoryStatsCommand } from "./answer-history-stats";
import { checkInstructorEnrollmentsCommand } from "./check-instructor-enrollments";
import { createCourseCommand } from "./create-course";
import { createEditionCommand } from "./create-edition";
import { createUserCommand } from "./create-user";
import { gradeObjectivesCommand } from "./grade-objectives";
import { importCalendarCommand } from "./import-calendar";
import { importResourcesCommand } from "./import-resources";
import { pruneTeamRepositoriesCommand } from "./prune-team-repositories";
import { recomputeEventTimesCommand } from "./recompute-event-times";
import { resetPasswordCommand } from "./reset-password";
import { settleCancelledSendsCommand } from "./settle-cancelled-sends";
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
manage.addCommand(checkInstructorEnrollmentsCommand);
manage.addCommand(gradeObjectivesCommand);
manage.addCommand(pruneTeamRepositoriesCommand);
manage.addCommand(settleCancelledSendsCommand);

await manage.parseAsync(process.argv);
