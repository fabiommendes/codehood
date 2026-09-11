# User Stories

This document describes how the other user stories documents are formatted. Each
document pertains to a specific user role, and is structured like so:

```md
# <role> user stories

<description of the role and its capabilities>

## <Sub-section I>

<list of stories, first section>

## <Sub-section II>

<list of stories, second section>

...

``` 

Each story is a self-contained scenario that describes a specific task or goal.
Story consists of a title, meta information and a narrative. The meta
information is a indented YAML block that contains the following fields:

```yaml
tested: flag # whether there is an implemented test for this story
implemented: flag # whether the story has been implemented
priority: string # one of  "critical" | "high" | "low"
```

All fields are optional. The flag fields default to `false` and the `priority`
field defaults to `"low"`. Flags can be either `true`, `false`, `"web"`,
`"cli"`. The `"web"` and `"cli"` flags indicate that the story is only partially
tested or implemented in either the web UI or CLI, respectively. Stories that
are relevant to a specific UI (Web-only or CLI-only) should use `true` when 
completed.

Stories are structured as follows:

```md
### <story title>

    tested: false
    implemented: false
    priority: "low"
    url: <url, if story pertains to a specific page>

<narrative of the story>
```

The narrative is a free-form text that describes the story in detail, including
the context, the actions taken by the user, and the expected outcome.

The story title can be slugified to create a unique identifier for the story.
The document cannot have slug collisions. Add a unique suffix to the title if
necessary to disambiguate.

When implementing tests for a story, describe them in a way that it can
be mapped back to this database. Add the story title (slugified or not) to the 
test name. The user role and section can be either explicitly present in the
title or implied by the test file name or test suite name.


## Tests

Tests are integration tests and should exercise the front-end in a way that 
mimicks what the user can do in the system. The tests typically seeds the
database with a known state, then performs actions on the front-end and checks
the results reading either the database or, if possible, the front-end itself. 
The database can either be an ephemeral in-memory database or a test database 
with rollback.

Some tests also exercise the integration with the codehood cli tool. They must
call the external CLI tool that is written in Python.