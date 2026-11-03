import { Command } from "commander";
import { createCourseCommand } from "./create-course";
import { createEditionCommand } from "./create-edition";
import { createUserCommand } from "./create-user";
import { importCalendarCommand } from "./import-calendar";
import { importResourcesCommand } from "./import-resources";
import { recomputeEventTimesCommand } from "./recompute-event-times";
import { resetPasswordCommand } from "./reset-password";

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

await manage.parseAsync(process.argv);
