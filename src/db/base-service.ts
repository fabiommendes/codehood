import type { Actor } from "@/auth/actor";
import type { CourseWithEnrollment } from "@/auth/permissions";
import type { ActionCode } from "@/core/error";
import { NotAllowed } from "@/core/error";
import type { CourseId } from "@/core/schemas";
import type { CourseRef } from "@/urls";
import { type PrismaClient, type PrismaTx, prisma } from "./client";
import { courseRefWhere, valueOrNotFound } from "./utils";

/**
 * Common set of options for service methods. `tx` is optional, but `actor` is required.
 */
export type ServiceOpts = {
	tx?: PrismaTx;
	actor: Actor;
	validate?: "both" | "none" | "input" | "output";
};
export type ServiceOptsWithoutTx = Omit<ServiceOpts, "tx">;

//
// Interface for common CRUD operations
//

export interface Create<In, Out> {
	/**
	 * Create a single entity.
	 */
	create<Opt extends ServiceOpts>(input: In, opts: Opt): Promise<Out>;
}

export interface FindOne<Pk, Out> {
	/**
	 * Find the first entity that matches the input criteria, or null if none is found.
	 */
	findOne<Opt extends ServiceOpts>(filter: Pk, opts: Opt): Promise<Out | null>;
}

export interface FindMany<Filter, Out> {
	/**
	 * Find all entities that match the input filters.
	 */
	findMany<Opt extends ServiceOpts>(filter: Filter, opts: Opt): Promise<Out[]>;
}

export interface Update<Pk, In, Out> {
	/**
	 * Update the first entity that matches the input criteria.
	 */
	update<Opt extends ServiceOpts>(
		filter: Pk,
		update: In,
		opts: Opt,
	): Promise<Out>;
}

export interface Upsert<In, Out> {
	/**
	 * Update an entity if it exists, or create it if it does not (upsert).
	 *
	 * PUT semantics: keyed on the entity's natural key, never on `id`. Fields
	 * left `undefined` keep their stored value; send `null` to clear one.
	 */
	upsert<Opt extends ServiceOpts>(input: In, opts: Opt): Promise<Out>;
}

export interface Delete<Pk> {
	// TODO: should delete return a response? return the deleted object?
	/**
	 * Delete the first entity that matches the input criteria.
	 */
	delete<Opt extends ServiceOpts>(filter: Pk, opts: Opt): Promise<void>;
}

type CrudT<
	Entity,
	Filter,
	Pk = Entity extends { id: unknown } ? { id: Entity["id"] } : unknown,
	Create = Omit<Entity, "id">,
	Update = Partial<Create>,
	Upsert = Create,
> = {
	entity: Entity;
	filter: Filter;
	create?: Create;
	pkFilter?: Pk;
	update?: Update;
	upsert?: Upsert;
};

/**
 * Expected composition of interfaces for a CRUD based service. Declare `never`
 * as the type of some operation to omit it from the service.
 */
export interface Crud<
	T extends CrudT<unknown, unknown, unknown, unknown, unknown, unknown>,
> extends Create<T["create"], T["entity"]>,
		FindMany<T["filter"], T["entity"]>,
		FindOne<T["pkFilter"], T["entity"]>,
		Update<T["pkFilter"], T["update"], T["entity"]>,
		Delete<T["pkFilter"]>,
		Upsert<T["upsert"], T["entity"]> {}

//
// Utilities and reusable logic
//

/**
 * Runs a `findOne`-then-`create`-or-`update` upsert inside a transaction.
 *
 * Reuses `opts.tx` when the caller already opened one, so an upsert nested in a
 * wider transaction does not open a second.
 */
export async function upsert<Entity, Filter, PkFilter, CreateIn, UpdateIn, In>(
	service: Crud<{
		entity: Entity;
		filter: Filter;
		pkFilter: PkFilter;
		create: CreateIn;
		update: UpdateIn;
		upsert: In;
	}>,
	input: In,
	args: ServiceOpts & {
		// The natural key the upsert is keyed on. Never `id`.
		pk: (input: In) => PkFilter;

		/// Defaults to passing `input` through unchanged.

		create?: (input: In) => CreateIn;

		/// Defaults to passing `input` through unchanged.
		update?: (input: In) => UpdateIn;

		/**
		 * Runs on the update branch only, to enforce the create-side permission
		 * that `create()` would have enforced had the row been absent.
		 *
		 * An upsert is a PUT: the same request must be allowed or refused
		 * regardless of whether the row already exists.
		 */
		assertCreatable?: (input: In, opts: ServiceOpts) => void | Promise<void>;

		action: ActionCode;
	},
): Promise<Entity> {
	const scoped: ServiceOpts = {
		tx: args.tx,
		actor: args.actor,
		validate: args.validate,
	};

	const pkFilter = args.pk(input);

	let existing: Entity | null;
	try {
		existing = await service.findOne(pkFilter, scoped);
	} catch (error) {
		throw error instanceof NotAllowed ? error.as(args.action) : error;
	}

	if (existing) {
		await args.assertCreatable?.(input, scoped);
		const update = args.update
			? args.update(input)
			: (input as unknown as UpdateIn);

		return service.update(pkFilter, update, scoped);
	}

	const create = args.create
		? args.create(input)
		: (input as unknown as CreateIn);

	return service.create(create, scoped);
}

/**
 * A base class for CRUD operations with transaction support.
 *
 * Provides default implementations for CRUD operations that can be overridden
 * by subclasses. It provides some common functionality that many Codehood
 * services may rely on.
 *
 * ## Notice for Subclasses
 *
 * The subclass may directly override the public CRUD methods. If the method
 * makes multiple database operations, prefer overriding the transaction-aware
 * methods (`createTx`, `findOneTx`, etc.) due to convenience and the guarantees
 * they provide.
 *
 * Document the private Tx variants as if they were the public CRUD methods
 * themselves.
 */
export class CrudBase<
	T extends CrudT<unknown, unknown, unknown, unknown, unknown, unknown>,
> implements
		Create<T["create"], T["entity"]>,
		FindMany<T["filter"], T["entity"]>,
		FindOne<T["pkFilter"], T["entity"]>,
		Update<T["pkFilter"], T["update"], T["entity"]>,
		Delete<T["pkFilter"]>,
		Upsert<T["upsert"], T["entity"]>
{
	protected readonly prisma: PrismaTx | PrismaClient;

	constructor(client: PrismaClient = prisma) {
		this.prisma = client;
	}

	protected $transaction<T, Opt extends ServiceOpts>(
		opts: Opt,
		fn: (tx: PrismaTx, scoped: Omit<Opt, "tx">) => Promise<T>,
	): Promise<T> {
		const withoutTx: Omit<Opt, "tx"> & { tx?: PrismaTx } = { ...opts };
		delete withoutTx.tx;

		if (opts.tx) return fn(opts.tx, withoutTx);
		return this.prisma.$transaction((tx) => fn(tx, withoutTx));
	}

	/**
	 * Create a new Entity.
	 *
	 * Subclasses may implement `createTx` to provide the actual creation logic
	 * in a transaction-aware manner.
	 */
	create<Opt extends ServiceOpts>(
		input: T["create"],
		opts: Opt,
	): Promise<T["entity"]> {
		return this.$transaction(opts, (tx, scoped) =>
			this.createTx(tx, input, scoped),
		);
	}

	protected createTx<Opt extends ServiceOptsWithoutTx>(
		_tx: PrismaTx,
		_input: T["create"],
		_opts: Opt,
	): Promise<T["entity"]> {
		throw new Error("Method not implemented.");
	}

	/**
	 * Find the first Entity matching `filter`, or `null` if none is found.
	 *
	 * Subclasses may implement `findOneTx` to provide the actual lookup logic
	 * in a transaction-aware manner.
	 */
	findOne<Opt extends ServiceOpts>(
		filter: T["pkFilter"],
		opts: Opt,
	): Promise<T["entity"] | null> {
		return this.$transaction(opts, (tx, scoped) =>
			this.findOneTx(tx, filter, scoped),
		);
	}

	protected findOneTx<Opt extends ServiceOptsWithoutTx>(
		_tx: PrismaTx,
		_filter: T["pkFilter"],
		_opts: Opt,
	): Promise<T["entity"] | null> {
		throw new Error("Method not implemented.");
	}

	/**
	 * Find all Entities matching `filter`.
	 *
	 * Subclasses may implement `findManyTx` to provide the actual lookup logic
	 * in a transaction-aware manner.
	 */
	findMany<Opt extends ServiceOpts>(
		filter: T["filter"],
		opts: Opt,
	): Promise<T["entity"][]> {
		return this.$transaction(opts, (tx, scoped) =>
			this.findManyTx(tx, filter, scoped),
		);
	}

	protected findManyTx<Opt extends ServiceOptsWithoutTx>(
		_tx: PrismaTx,
		_filter: T["filter"],
		_opts: Opt,
	): Promise<T["entity"][]> {
		throw new Error("Method not implemented.");
	}

	/**
	 * Update the first Entity matching `filter`.
	 *
	 * Subclasses may implement `updateTx` to provide the actual update logic
	 * in a transaction-aware manner.
	 */
	update<Opt extends ServiceOpts>(
		filter: T["pkFilter"],
		update: T["update"],
		opts: Opt,
	): Promise<T["entity"]> {
		return this.$transaction(opts, (tx, scoped) =>
			this.updateTx(tx, filter, update, scoped),
		);
	}

	protected updateTx<Opt extends ServiceOptsWithoutTx>(
		_tx: PrismaTx,
		_filter: T["pkFilter"],
		_update: T["update"],
		_opts: Opt,
	): Promise<T["entity"]> {
		throw new Error("Method not implemented.");
	}

	/**
	 * Update an Entity if it exists, or create it if it does not (upsert).
	 *
	 * Subclasses may implement `upsertTx` to provide the actual upsert logic
	 * in a transaction-aware manner.
	 */
	upsert<Opt extends ServiceOpts>(
		input: T["upsert"],
		opts: Opt,
	): Promise<T["entity"]> {
		return this.$transaction(opts, (tx, scoped) =>
			this.upsertTx(tx, input, scoped),
		);
	}

	protected upsertTx<Opt extends ServiceOptsWithoutTx>(
		_tx: PrismaTx,
		_input: T["upsert"],
		_opts: Opt,
	): Promise<T["entity"]> {
		throw new Error("Method not implemented.");
	}

	/**
	 * Delete the first Entity matching `filter`.
	 *
	 * Subclasses may implement `deleteTx` to provide the actual deletion logic
	 * in a transaction-aware manner.
	 */
	delete<Opt extends ServiceOpts>(
		filter: T["pkFilter"],
		opts: Opt,
	): Promise<void> {
		return this.$transaction(opts, (tx, scoped) =>
			this.deleteTx(tx, filter, scoped),
		);
	}

	protected deleteTx<Opt extends ServiceOptsWithoutTx>(
		_tx: PrismaTx,
		_filter: T["pkFilter"],
		_opts: Opt,
	): Promise<void> {
		throw new Error("Method not implemented.");
	}

	/**
	 * Reusable logic to find the course by reference or ID.
	 *
	 * @throws {@link NotFound}
	 * If the course cannot be found.
	 *
	 * @throws {@link NotAllowed}
	 * If actor is not permitted to access the course with the desired action.
	 */
	protected async course<
		Opt extends ServiceOpts & { action?: "view" | "manage" },
	>(
		ref: CourseRef | CourseId,
		tx: PrismaTx | undefined,
		opts: Opt,
	): Promise<CourseWithEnrollment & { id: CourseId }> {
		const client = tx ?? opts.tx ?? this.prisma;

		let course = await client.course.findUnique({
			where: courseRefWhere(ref),
			select: { id: true, instructor: { select: { username: true } } },
		});
		course = valueOrNotFound("course", course);

		return {
			id: course.id as CourseId,
			instructor: course.instructor,
			enrollments: [],
		};
	}
}
