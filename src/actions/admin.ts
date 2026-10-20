import { defineAction } from "astro:actions";
import { requireUser } from "@/auth/require-user";
import { FieldError } from "@/core/error";
import {
	disciplineCreate,
	disciplineEdit,
	disciplinePK,
	editionForm,
	editionPK,
	inviteRevoke,
	userByUsername,
	userCreateForm,
} from "@/core/schemas";
import { db } from "@/db";
import { publicUser } from "./auth";
import { withServiceErrors } from "./helpers";

export const admin = {
	createEdition: defineAction({
		accept: "form",
		input: editionForm,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			return db.edition.create(input, { actor });
		}),
	}),

	updateEdition: defineAction({
		accept: "form",
		input: editionForm,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			const { slug, ...fields } = input;
			return db.edition.update({ slug }, fields, { actor });
		}),
	}),

	deleteEdition: defineAction({
		accept: "form",
		input: editionPK,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			await db.edition.delete({ slug: input.slug }, { actor });
		}),
	}),

	forceLogout: defineAction({
		accept: "form",
		input: userByUsername,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			await db.session.delete({ username: input.username }, { actor });
		}),
	}),

	createDiscipline: defineAction({
		accept: "form",
		input: disciplineCreate,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			return db.discipline.create(input, { actor });
		}),
	}),

	updateDiscipline: defineAction({
		accept: "form",
		input: disciplineEdit,
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
		input: disciplinePK,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			await db.discipline.delete({ slug: input.slug }, { actor });
		}),
	}),

	revokeInvite: defineAction({
		accept: "form",
		input: inviteRevoke,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			await db.invite.delete({ publicId: input.publicId }, { actor });
		}),
	}),

	createUser: defineAction({
		accept: "form",
		input: userCreateForm,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			// db.user.create has no uniqueness pre-check of its own (see
			// manage create-user, which does this same check before calling it)
			// — without it, a collision surfaces as a raw Prisma constraint error
			// instead of a message naming the field that collided.
			if (await db.user.findOne({ email: input.email }, { actor })) {
				throw new FieldError(
					"email",
					`A user with email ${input.email} already exists.`,
				);
			}
			if (await db.user.findOne({ username: input.username }, { actor })) {
				throw new FieldError(
					"username",
					`A user with username ${input.username} already exists.`,
				);
			}
			const user = await db.user.create(input, { actor });
			return publicUser(user);
		}),
	}),
};
