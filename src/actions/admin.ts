import { defineAction } from "astro:actions";
import { z } from "astro/zod";
import { requireUser } from "@/auth/require-user";
import { disciplineService } from "@/db/discipline.service";
import { editionService } from "@/db/edition.service";
import { inviteService } from "@/db/invite.service";
import { sessionService } from "@/db/session.service";
import { userService } from "@/db/user.service";
import { USERNAME_RE } from "@/utils/course-url";
import { withServiceErrors } from "./helpers";

export const admin = {
	createEdition: defineAction({
		accept: "form",
		input: z.object({
			// Format is validated by editionService.create itself, which throws a
			// clean, form-facing message ("... is not a valid edition slug ...");
			// duplicating the regex here would instead surface Astro's raw
			// input-validation error, a JSON dump of the failing Zod issue.
			slug: z.string().min(1),
			name: z.string().min(1),
			startAt: z.coerce.date(),
			endAt: z.coerce.date(),
		}),
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			return editionService.create(input, { actor });
		}),
	}),

	updateEdition: defineAction({
		accept: "form",
		input: z.object({
			slug: z.string(),
			name: z.string().min(1),
			startAt: z.coerce.date(),
			endAt: z.coerce.date(),
		}),
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			const { slug, ...fields } = input;
			return editionService.update({ slug }, fields, { actor });
		}),
	}),

	deleteEdition: defineAction({
		accept: "form",
		input: z.object({ slug: z.string() }),
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			await editionService.delete({ slug: input.slug }, { actor });
		}),
	}),

	forceLogout: defineAction({
		accept: "form",
		input: z.object({ userId: z.coerce.number().int() }),
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			await sessionService.delete({ userId: input.userId }, { actor });
		}),
	}),

	createDiscipline: defineAction({
		accept: "form",
		input: z.object({
			// Format (and the reserved-slug check) is validated by
			// disciplineService.create itself — see the note on createEdition's
			// slug for why that isn't duplicated here.
			slug: z.string().min(1),
			name: z.string().min(1),
		}),
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			return disciplineService.create(input, { actor });
		}),
	}),

	updateDiscipline: defineAction({
		accept: "form",
		input: z.object({ slug: z.string(), name: z.string().min(1) }),
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			return disciplineService.update(
				{ slug: input.slug },
				{ name: input.name },
				{ actor },
			);
		}),
	}),

	deleteDiscipline: defineAction({
		accept: "form",
		input: z.object({ slug: z.string() }),
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			await disciplineService.delete({ slug: input.slug }, { actor });
		}),
	}),

	revokeInvite: defineAction({
		accept: "form",
		input: z.object({ id: z.coerce.number().int() }),
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			await inviteService.delete({ id: input.id }, { actor });
		}),
	}),

	createUser: defineAction({
		accept: "form",
		input: z.object({
			name: z.string().min(1),
			email: z.email(),
			username: z.string().regex(USERNAME_RE, "Invalid username."),
			role: z.enum(["ADMIN", "INSTRUCTOR", "STUDENT"]),
			password: z.string().min(8),
			// Required for non-admins, optional for admins — userService.create
			// enforces that and throws its own clean message, so this stays loose.
			githubId: z.string().optional(),
			schoolId: z.string().optional(),
		}),
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			// userService.create has no uniqueness pre-check of its own (see
			// manage create-user, which does this same check before calling it)
			// — without it, a collision surfaces as a raw Prisma constraint error
			// instead of a message naming the field that collided.
			if (await userService.findOne({ email: input.email }, { actor })) {
				throw new Error(`A user with email ${input.email} already exists.`);
			}
			if (await userService.findOne({ username: input.username }, { actor })) {
				throw new Error(
					`A user with username ${input.username} already exists.`,
				);
			}
			return userService.create(input, { actor });
		}),
	}),
};
