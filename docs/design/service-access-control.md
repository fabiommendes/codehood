# Access control in the service layer

Astro Actions and REST controllers are thin wrappers around `src/db/*.service.ts`.
That only holds if the services themselves decide what a caller may see, because
otherwise every wrapper has to remember to re-apply the same filter, and one that
forgets leaks data with no visible symptom.

So the rule is: a service method that returns different results to different
people takes the actor as an argument and applies the rule itself. Callers do not
post-filter.

## The actor

```ts
// src/db/base-service.ts
export const SYSTEM = Symbol("system");
export const FULL_ACCESS = Object.freeze({ actor: SYSTEM } as const);
export type Actor = AuthUser | typeof SYSTEM;

export type ServiceMethodOpts = { tx?: PrismaTx; actor?: Actor };
export type ActingOpts = { tx?: PrismaTx; actor: Actor };
```

`FULL_ACCESS` is frozen because it is a single object shared by every trusted
call site. One caller doing `FULL_ACCESS.tx = tx` to save a keystroke would
silently route unrelated queries through a finished transaction. Freezing turns
that into a thrown error at the point of the mistake.

The actor is `AuthUser`, which is `{ id, role }`, and that is exactly what
`Astro.locals.user` holds after the session or API-key middleware runs. So an
action passes `locals.user` straight through. Typing the actor as a full `User`
row instead would mean a database round trip on every request just to build the
argument, before the service does the query the caller actually wanted.

`base-service.ts` currently declares `actor?: User`, using its own local `User`
type. That type is not assignable from `locals.user` and needs to become
`Actor`.

`SYSTEM` is for callers with no user behind them: seeds, `manage` commands,
`ensureDevAdmin`, and the inside of the invite-redemption transaction, which
enrolls an account that does not have a session yet. It is a symbol rather than a
string or `null` so it can never arrive by accident from parsed JSON or a
forgotten variable. Writing `SYSTEM` is a decision you can see in a diff.

## Making the actor impossible to forget

Access control that fails open is worse than none, because it looks like it is
working. The base CRUD interfaces have optional `opts`, which means a missing
actor would compile fine and quietly return everything.

So access-controlled methods get their own interfaces, with `opts` required and
`actor` required inside it:

```ts
export interface FindOneAs<FilterIn, Out> {
  findOne(filter: FilterIn, opts: ActingOpts): Promise<Out | null>;
}

export interface FindManyAs<FilterIn, Out> {
  findMany(filter: FilterIn, opts: ActingOpts): Promise<Out[]>;
}

export interface CreateAs<In, Out> {
  create(input: In, opts: ActingOpts): Promise<Out>;
}

export interface UpdateAs<FilterIn, UpdateIn, Out> {
  update(filter: FilterIn, update: UpdateIn, opts: ActingOpts): Promise<Out>;
}

export interface DeleteAs<FilterIn> {
  delete(filter: FilterIn, opts: ActingOpts): Promise<void>;
}
```

The `FULL_ACCESS` constant helps calling code that runs in `SYSTEM` mode and has
no transactions. The calling convention is `service.findOne(filter, FULL_ACCESS)` 
rather than `service.findOne(filter, { actor: SYSTEM })`.

A service picks per method. `DisciplineService` implements plain `FindMany`,
because every user sees every discipline, and `CreateAs`, because not everyone
may add one. The class declaration then tells you which operations carry rules
without reading a single method body.

`UserService`, `SessionService`, `ApiKeyService`, and `InviteService` all move
onto these interfaces too, rather than waiting until each grows a rule.

Which leaves the omitted-actor default in `docs/design/db-service-classes.md`
covering nothing once that migration finishes. That is fine, and it is the
intended end state: the default is what a service looks like before anyone has
thought about who may call it, and every service that has been thought about
requires the argument. If a new service genuinely has nothing to hide, it can
keep the plain interfaces, and the reviewer's question is then "is that true?"
rather than "did someone forget?".

## Filter or throw, depending on arity

List methods filter. Single-item methods throw.

`findMany` narrows its `where` clause by the actor's visibility and returns
whatever survives. Asking for something you cannot see gives you fewer rows, not
an error. 

`findOne` distinguishes two failures, because the pages above it need to:

- The row does not exist. Return `null`. The page renders 404.
- The row exists and the actor may not see it. Throw
  `ActionError({ code: "FORBIDDEN" })`. The page renders 403 and can name the
  thing the user asked for.

Write methods always throw `FORBIDDEN`. There is no silent no-op, ever. A
delete that quietly does nothing is a bug report six months later.

Deciding this per-method rather than globally is the point. If both behaved the
same way you would have to choose between listing pages that explode and detail
pages that lie about what exists.

## Two encodings of one rule, kept adjacent

Every rule exists twice. Once as a predicate over a loaded row, for `findOne`
and for the UI deciding whether to render a button. Once as a Prisma `where`
fragment, for `findMany` to push into SQL instead of loading the table and
filtering in JavaScript.

```ts
export function canViewCourse(actor: Actor, course: CourseWithInstructor): boolean;
export function courseVisibility(actor: Actor): Prisma.CourseWhereInput;
```

Both live in `src/auth/permissions.ts`, next to each other. They will drift
otherwise, and a drifted pair is invisible: the list page and the detail page
just start disagreeing about one course.

Adjacency is not enough on its own, so each pair also gets a test that builds a
fixture set, runs `findMany` over it, and asserts the result equals the rows for
which the predicate returns true. That test is the actual guarantee. The
side-by-side placement only makes the drift easy to spot in review.

## Bots act as their owner

The API-key middleware sets `locals.user` to the key's owner, so a grading bot
sees exactly what the instructor who issued its key sees. `locals.apiKey.kind`
is recorded but does not narrow visibility yet. Giving bots a smaller scope than
their owner is worth doing before any bot runs against real student data, and it
belongs in whichever spec first gives a bot something to read.

## Adding rules to a service

1. Write the predicate and the Prisma fragment together in `permissions.ts`.
2. Switch the affected methods to the `*As` interfaces.
3. Add the agreement test for the new pair.
4. Update the visibility table in the spec that owns the feature.
