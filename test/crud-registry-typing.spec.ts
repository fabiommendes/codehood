import { expect, test } from "@playwright/test";
import { z } from "zod";
import { CRUD } from "@/api/registry";

/**
 * `CRUD()` asks the service for `create` and `upsert` only when the route has
 * a create schema, and never registers a `PUT` without one.
 */

const entity = z.object({ slug: z.string() });
const key = z.object({ slug: z.string() });
const update = z.object({ title: z.string() });

/// A service with every method but `create` and `upsert`.
const readUpdateDelete = {
	findOne: async (_key: { slug: string }) => ({ slug: "a" }),
	findMany: async (_filter: unknown) => [{ slug: "a" }],
	update: async (_key: { slug: string }, _fields: { title: string }) => ({
		slug: "a",
	}),
	delete: async (_key: { slug: string }) => {},
};

test("a route without a create schema takes a service without create and registers no POST or PUT", () => {
	const routes = CRUD("/api/test-crud-no-create", {
		name: "NoCreate",
		entity,
		create: null,
		update,
		filter: null,
		key,
		tags: ["Test"],
		service: readUpdateDelete,
	});
	expect(routes.create).toBeFalsy();
	expect(routes.upsert).toBeFalsy();
	expect(routes.update).toBeTruthy();
});

test("a route with a create schema still requires create and upsert on the service", () => {
	const register = () =>
		CRUD("/api/test-crud-with-create", {
			name: "WithCreate",
			entity,
			create: z.object({ slug: z.string() }),
			update,
			filter: null,
			key,
			tags: ["Test"],
			// @ts-expect-error - the service has no `create` nor `upsert`
			service: readUpdateDelete,
		});
	expect(typeof register).toBe("function");
});
