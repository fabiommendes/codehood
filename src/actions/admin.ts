import { defineAction } from "astro:actions";
import { z } from "astro/zod";
import { requireUser } from "@/auth/require-user";
import { db, type schema } from "@/db";
import { USERNAME_RE } from "@/urls";
import { withServiceErrors } from "./helpers";

export const admin = {
	createEdition: defineAction({
		accept: "form",
		input: z.object({
			// Format is validated by db.edition.create itself, which throws a
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
			return db.edition.create(input, { actor });
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
			return db.edition.update({ slug }, fields, { actor });
		}),
	}),

	deleteEdition: defineAction({
		accept: "form",
		input: z.object({ slug: z.string() }),
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			await db.edition.delete({ slug: input.slug }, { actor });
		}),
	}),

	forceLogout: defineAction({
		accept: "form",
		input: z.object({ username: z.string() }),
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			await db.session.delete({ username: input.username }, { actor });
		}),
	}),

	createDiscipline: defineAction({
		accept: "form",
		input: z.object({
			// Format (and the reserved-slug check) is validated by
			// db.discipline.create itself — see the note on createEdition's
			// slug for why that isn't duplicated here.
			slug: z.string().min(1),
			name: z.string().min(1),
		}),
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			return db.discipline.create(input, { actor });
		}),
	}),

	updateDiscipline: defineAction({
		accept: "form",
		input: z.object({ slug: z.string(), name: z.string().min(1) }),
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			return db.discipline.update(
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
			await db.discipline.delete({ slug: input.slug }, { actor });
		}),
	}),

	revokeInvite: defineAction({
		accept: "form",
		input: z.object({ id: z.coerce.number().int() }),
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			await db.invite.delete({ id: input.id as schema.InviteId }, { actor });
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
			// Required for non-admins, optional for admins — db.user.create
			// enforces that and throws its own clean message, so this stays loose.
			githubId: z.string().optional(),
			schoolId: z.string().optional(),
		}),
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			// db.user.create has no uniqueness pre-check of its own (see
			// manage create-user, which does this same check before calling it)
			// — without it, a collision surfaces as a raw Prisma constraint error
			// instead of a message naming the field that collided.
			if (await db.user.findOne({ email: input.email }, { actor })) {
				throw new Error(`A user with email ${input.email} already exists.`);
			}
			if (await db.user.findOne({ username: input.username }, { actor })) {
				throw new Error(
					`A user with username ${input.username} already exists.`,
				);
			}
			return db.user.create(input, { actor });
		}),
	}),
};
