# Database modelling and design

This document describes the database guidelines for creating new models and
relationships. It is intended for developers and agents who are implementing new
features and need to create new database models.

## Ids

Avoid using UUIDs as primary keys. Auto-incrementing integers are simpler and
more efficient. This is not a distributed system, so no coordination is needed.

Sometimes we want a "public-facing" identifier that goes in URLs slugs and
should not be easily guessable. In those cases, use a separate `publicId` field
with a unique constraint. It should be a random string of 10 URL-safe
characters. Use nanoid to generate it in the service layer, not in the database.



