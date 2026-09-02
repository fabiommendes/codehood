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
* Read: `findOne(filter, opts):`
* List: `findMany(filter, opts)`
* Update: `update(filter, data, opts)`
* Delete: `delete(filter, opts)`

The precise types are documented in the interface definitions at `src/db/base-service.ts`.

Implement the whole set, even when the feature being built only needs part of
it. These classes are what the REST API exposes as resources, so a method left
out here becomes a missing endpoint later, and adding it during the original
work costs far less than a second pass over the same class. Where a method has
no obvious meaning for a model, say what it does mean — `update` on an invite
extends its expiry and adjusts `maxUses`, and nothing else — rather than
omitting it or letting it accept everything.

All methods take an `opts` parameter with two properties:

* tx (optional): a Prisma transaction object, used to run the query in a transaction or mock db.
* actor (optional): a user object, used to enforce access control.


## Access control and permissions

For all methods, if the `actor` is omitted, treat as system access to the
resource and allow all operations. If `actor` is provided, enforce access control
based on the user's role and the resource being accessed.

Each service has specific business rules for access and they should be specified
at each spec document.

A service that carries real rules opts out of the omitted-actor default by
implementing the `*As` interfaces instead, which make `opts` and `actor`
required. Trusted callers then say `FULL_ACCESS` rather than passing nothing.
Silence means system access is a fine default for a service where every caller
may see everything; it is a bad one where they may not, because a forgotten
argument fails open. See `docs/design/service-access-control.md` for the rules on
when to tighten, and on filtering versus throwing.