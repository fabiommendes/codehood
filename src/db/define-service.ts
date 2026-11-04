/**
 * Builder for services: each operation is written once, against a transaction,
 * and `defineService` derives the public method that opens (or reuses) it.
 *
 * Only the operations a service provides exist on the result, so a missing one
 * is a type error rather than a `Method not implemented` at run time (ADR 0004).
 */
import type { ZodType } from "zod";
import { ImproperBehavior, InvalidData } from "@/core/error";
import { type SchemaItem, validateArgs } from "@/utils/validate";
import type {
	CrudT,
	ServiceOpts,
	ServiceOptsWithoutTx,
	UpsertIn,
} from "./base-service";
import { type PrismaClient, type PrismaTx, prisma } from "./client";

/**
 * An operation written against a transaction: `tx` first, then the operation's
 * own arguments, then the options without `tx`.
 */
export type TxOp<Args extends unknown[], R> = (
	tx: PrismaTx,
	...args: [...Args, ServiceOptsWithoutTx]
) => Promise<R>;

// biome-ignore lint/suspicious/noExplicitAny: matches any operation's arguments
type AnyTxOp = (tx: PrismaTx, ...args: any[]) => Promise<unknown>;

/// The shape `defineService()` takes when no CRUD shape is given: nothing is constrained.
type Loose = {
	// biome-ignore-start lint/suspicious/noExplicitAny: no constraint on the operations
	entity: any;
	filter: any;
	pkFilter: any;
	create: any;
	update: any;
	// biome-ignore-end lint/suspicious/noExplicitAny: End
};

/// The CRUD operations a service may provide, typed after its `CrudT` shape.
export type CrudOps<
	T extends CrudT<unknown, unknown, unknown, unknown, unknown>,
> = {
	create?: TxOp<[T["create"]], T["entity"]>;
	findOne?: TxOp<[T["pkFilter"]], T["entity"] | null>;
	findMany?: TxOp<[T["filter"]], T["entity"][]>;
	update?: TxOp<[T["pkFilter"], T["update"]], T["entity"]>;
	upsert?: TxOp<[UpsertIn<T>], T["entity"]>;
	delete?: TxOp<[T["pkFilter"]], void>;
};

/// The public form of an operation: no `tx`, and `ServiceOpts` required last.
type PublicOp<F> = F extends (tx: PrismaTx, ...rest: infer R) => infer P
	? R extends [...infer A, ServiceOptsWithoutTx]
		? (...args: [...A, ServiceOpts]) => P
		: never
	: never;

/** The service object `defineService` builds: one public method per provided operation. */
export type Service<O> = { [K in keyof O]: PublicOp<O[K]> };

/**
 * Runs `fn` on `opts.tx` when there is one, and otherwise inside a transaction
 * opened on `client`.
 *
 * `fn` receives the options without `tx`, so nested calls pass the transaction
 * explicitly.
 */
export function inTx<R, Opt extends ServiceOpts>(
	client: PrismaClient,
	opts: Opt,
	fn: (tx: PrismaTx, scoped: Omit<Opt, "tx">) => Promise<R>,
): Promise<R> {
	const scoped: Omit<Opt, "tx"> & { tx?: PrismaTx } = { ...opts };
	delete scoped.tx;

	if (opts.tx) return fn(opts.tx, scoped);
	return client.$transaction((tx) => fn(tx, scoped));
}

/**
 * Wraps `run` with input validation of its arguments and output validation of
 * its result, both switched off by `opts.validate`.
 *
 * `args` are positional over the operation's own arguments, leaving out `tx`
 * and the trailing options. `transaction: false` makes the service method run
 * the operation on `opts.tx` or, without one, directly on the client, for reads
 * and for operations that open their own transactions around slow I/O.
 *
 * @throws {@link InvalidData} When an argument or the result fails its schema.
 */
export function op<Args extends unknown[], R>(spec: {
	args?: SchemaItem[];
	returns?: ZodType<unknown>;
	transaction?: boolean;
	run: TxOp<Args, R>;
}): TxOp<Args, R> {
	const { args: schemas, returns, run } = spec;
	const hasArgSchemas = schemas?.some((schema) => schema !== undefined);

	const operation: TxOp<Args, R> = async (tx, ...rest) => {
		const opts = rest[rest.length - 1] as ServiceOptsWithoutTx | undefined;
		if (typeof opts !== "object" || opts === null || !("actor" in opts)) {
			throw new ImproperBehavior(
				`${run.name || "operation"}: the last argument is not a ServiceOpts object`,
			);
		}

		let args = rest.slice(0, -1);
		if (
			schemas &&
			hasArgSchemas &&
			opts.validate !== "none" &&
			opts.validate !== "output"
		) {
			args = validateArgs(schemas, args);
		}

		const result = await run(
			tx,
			...([...args, opts] as [...Args, ServiceOptsWithoutTx]),
		);

		if (returns && opts.validate !== "none" && opts.validate !== "input") {
			const parsed = returns.safeParse(result);
			if (!parsed.success) throw InvalidData.fromZodError(parsed.error, result);
		}
		return result;
	};
	if (spec.transaction === false) withoutTransaction.add(operation);
	return operation;
}

/// Operations built with `transaction: false`.
const withoutTransaction = new WeakSet<AnyTxOp>();

/**
 * Starts a service definition, optionally checking the CRUD operations against
 * a `CrudT` shape; call the result with a function that builds the operations.
 *
 * The second call is separate because TypeScript cannot infer the operations
 * while the shape is given explicitly.
 *
 * ```ts
 * const makeFooService = defineService<FooT>()((client) => ({
 *   findOne: op({ run: async (tx, pk: FooPK, opts) => ... }),
 * }));
 * const fooService = makeFooService(); // uses the shared client
 * ```
 */
export function defineService<
	T extends CrudT<unknown, unknown, unknown, unknown, unknown> = Loose,
>() {
	return <O extends CrudOps<T> & Record<string, AnyTxOp>>(
		build: (client: PrismaClient) => O,
	) =>
		(client: PrismaClient = prisma): Service<O> => {
			const service: Record<string, unknown> = {};
			for (const [name, operation] of Object.entries(build(client))) {
				const direct = withoutTransaction.has(operation);
				service[name] = (...args: unknown[]) => {
					const opts = args[args.length - 1] as ServiceOpts;
					if (direct) {
						const { tx, ...scoped } = opts ?? ({} as ServiceOpts);
						return operation(tx ?? client, ...args.slice(0, -1), scoped);
					}
					return inTx(client, opts, (tx, scoped) =>
						operation(tx, ...args.slice(0, -1), scoped),
					);
				};
			}
			return service as Service<O>;
		};
}
