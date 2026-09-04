import { input, password as passwordPrompt } from "@inquirer/prompts";
import { Command } from "commander";
import { FULL_ACCESS } from "@/core/actor";
import type { Role } from "@/db/client";
import { userService } from "@/db/services/user.service";

const ROLES: Role[] = ["ADMIN", "INSTRUCTOR", "STUDENT"];

export const createUserCommand = new Command("create-user")
	.description("Create a user with a given role and password")
	.argument("[email]", "email address for the new user")
	.option("-r, --role <role>", "ADMIN, INSTRUCTOR, or STUDENT", "STUDENT")
	.action(async (email: string | null, opts: { role: string }) => {
		const role = opts.role.toUpperCase() as Role;
		if (!ROLES.includes(role)) {
			console.error(
				`Invalid role: ${opts.role}. Expected one of ${ROLES.join(", ")}.`,
			);
			process.exitCode = 1;
			return;
		}
		console.log(`Creating a new ${role.toLowerCase()} user...`);

		if (!email) {
			email = await input({ message: "Email address:" });
		}

		if (await userService.findOne({ email }, FULL_ACCESS)) {
			console.error(`A user with email ${email} already exists.`);
			process.exitCode = 1;
			return;
		}

		const username = await input({ message: "Username:" });
		if (await userService.findOne({ username }, FULL_ACCESS)) {
			console.error(`A user with username ${username} already exists.`);
			process.exitCode = 1;
			return;
		}

		const name = await input({ message: "Name:" });
		const githubId =
			role === "ADMIN"
				? undefined
				: await input({ message: "GitHub username:" });
		const schoolId =
			role === "ADMIN" ? undefined : await input({ message: "School id:" });

		const plainPassword = await passwordPrompt({
			message: "Password:",
			mask: "*",
		});
		const confirmation = await passwordPrompt({
			message: "Confirm password:",
			mask: "*",
		});
		if (plainPassword !== confirmation) {
			console.error("Passwords do not match.");
			process.exitCode = 1;
			return;
		}

		const user = await userService.create(
			{
				email,
				name,
				role,
				username,
				password: plainPassword,
				githubId,
				schoolId,
			},
			FULL_ACCESS,
		);

		console.log(
			`Created ${user.role.toLowerCase()} ${user.email} (id=${user.id}).`,
		);
	});
