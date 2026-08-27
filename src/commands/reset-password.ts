import { password as passwordPrompt } from "@inquirer/prompts";
import { Command } from "commander";
import { FULL_ACCESS } from "@/db/base-service";
import { userService } from "@/db/user.service";

export const resetPasswordCommand = new Command("reset-password")
	.description("Reset the password for a given user")
	.argument("<email>", "email address of the user")
	.action(async (email: string) => {
		const user = await userService.findOne({ email }, FULL_ACCESS);
		if (!user) {
			console.error(`No user with email ${email}.`);
			process.exitCode = 1;
			return;
		}

		const password = await passwordPrompt({
			message: "New password:",
			mask: "*",
		});
		const confirmation = await passwordPrompt({
			message: "Confirm password:",
			mask: "*",
		});
		if (password !== confirmation) {
			console.error("Passwords do not match.");
			process.exitCode = 1;
			return;
		}

		await userService.updatePassword(user, password, FULL_ACCESS);
		console.log(`Password updated for ${user.email}.`);
	});
