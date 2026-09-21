# Database service classes

This document describes the design of the database service classes, which wraps
the Prisma client and provides a higher-level API for the rest of the server to
use. The service classes are responsible for enforcing business rules and
validating input, and they should not leak Prisma types to the rest of the
server.


## Restful API

The classes are designed to be used in a RESTful way, with methods that correspond to
the standard CRUD operations. Each class should have methods for creating, reading,
updating, and deleting records, as well as any additional methods that are needed
for the specific model.

* Create: `create(data, opts)`
* Read: `findOne(filterPk, opts):`
* List: `findMany(filter, opts)`
* Update: `update(filterPk, data, opts)`
* Upsert: `upsert(data, opts)`
* Delete: `delete(filterPk, opts)`

Organize the methods in the order they are listed above: create, findOne,
findMany, update, upsert, delete. Any additional public methods are listed
after the standard CRUD methods, finally, private utilities should be defined 
at the end of the class in a separate section use a comment separator like
`// Private utilities -----` that spans up to column 80.

The precise types are documented in the interface definitions at `src/db/base-service.ts`.

Implement the whole set, even when the feature being built only needs part of
it. You can use never types to flag those missing methods, when possible.

All methods take a required `opts` parameter:

* `actor` (**required**): who the call is made on behalf of, used to enforce
  access control. Either a user or the `SYSTEM` sentinel; trusted callers with
  no transaction pass the `FULL_ACCESS` constant. It is required rather than
  optional on purpose: access control that fails open looks like it is
  working, and an omitted actor would compile fine and quietly return
  everything.
* `tx` (optional): a Prisma transaction object, used to run the query in a
  transaction or mock db.
* `validate` (optional): "both" (default), "none", "input", or "output".
  Controls whether input and/or output validation is performed.

A method that declares `opts?` instead of `opts` reintroduces the fail-open
hole. Do not add one.


## Input and output validation

Every service method, (including the methodTx variants) is wrapped in
`@Validate`, which checks its arguments against a schema on the way in and its
return value against `returns:` on the way out.

Input schemas protect the database consistency. They validate if the input data
conforms to the expected rules and it should be as tight as the domain allows.
A loose input schema introduces bugs and business rule violations. It is 
acceptable for the input schema to coerce values into the correct format.

Output schemas protect the shape of the data leaving the service against
implementation bugs and (most importantly) data leaks. They should never coerce
values, but may not be as strict as input schemas in the sense that we trust
data retrieved from the database is already valid. Double validation may incur
unnecessary performance overhead and may fire exceptions for minor bugs that
might otherwise have no impact.

### Deriving create and update schemas

Write `xCreate`/`xUpdate` as `xSchema.pick(...)` / `.omit(...)` / `.extend(...)`
/ `.partial()` rather than retyping the fields. A retyped schema drifts from its
entity silently: a new column reaches the database with nothing rejecting it on
the way in. Where an input field genuinely differs from the entity's, `extend`
it, so the difference reads as a deliberate difference.

### `.optional()` versus `.nullish()`

- plain — required.
- `.optional()` — "I am not saying", so the field keeps whatever it has.
- `.nullish()` — "I can also say nothing", so `null` clears the column.

Every create/update field over a nullable column must be `.nullish()`. An
`.optional()` field over a nullable column cannot be cleared: `undefined`
reaches Prisma as "leave it alone".

The exception is output-shape optionality, which is not about a column at all:
`apiKeySchema.token` and `inviteSchema.token` are `.optional()` because they are
present only in the create response.

## Access control and permissions

Methods require an explicit `actor` argument in the `ServiceOpts` argument.
Each service has specific business rules for access and they should be specified
at each spec document.

Use the permission system defined in `src/auth/permissions.ts` to enforce access
control for each service method. The `hasPerm` and `ensurePerm` are the
workhorse functions are the primary tools for checking permissions. 

Permission in `findMany` queries should be carefully considered. Some records can
be preemptly filtered in the actual database query without filtering data in 
post-processing. We should prefer this approach when possible, but even if the
filtering is done at database level, assert the access control rule for each
record in the collection. 

This redundant check is not necessary if all entries depend on a common resource
like, for instance, the course to which all questions belong. In that case, do 
not declare per-entry permissions and verify the parent resource instead.

This redundancy ensures that if there is any code drift in the business logic,
we will get a runtime exception instead of a silent failure without an
unauthorized data leak. Those failures should be caught during testing.

## Error handling and gotchas

* The .create() method should check if object exists and throw the proper error
  instead of letting it bubble up as an error 500. The
  `@db/utils:invalidIfExists` helper simplifies this verification.


## Soft delete

Classes that implement soft delete should provide a `deletedAt` timestamp
column. They reuse the delete() interface and for the callers there should not
be any difference in behavior compared to a hard delete. 


## REST API

Most services also have a corresponding REST API. If the API is available,
implement the examples in the /test/bruno directory.