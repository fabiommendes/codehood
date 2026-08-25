import { Command } from "commander";
import { createUserCommand } from "./create-user";
import { resetPasswordCommand } from "./reset-password";

const manage = new Command("manage").description(
	"Codehood server management commands",
);

manage.addCommand(createUserCommand);
manage.addCommand(resetPasswordCommand);

await manage.parseAsync(process.argv);
