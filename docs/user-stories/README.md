# User stories

This directory is the catalogue of what Codehood promises its users. One document
per role, `student.md`, `instructor.md` and `admin.md`, each structured like so:

```md
# <role> user stories

<what the role is and what it may do>

## <section>

<the stories in that section>
```

## A story

```md
### <story title>

    status: implemented
    url: /profile

<narrative>
```

The title slugifies to the story's identifier. A document cannot contain two
titles with the same slug; add a distinguishing word rather than a suffix.

The metadata block is indented YAML with two optional fields.

`status` says how much of the story is built. It is `todo` when nothing is,
`implemented` when all of it is, and `web` or `cli` when only that half works. A
story whose whole surface is the CLI, such as pushing resources, is `cli` until
it works end to end and `implemented` after. `todo` is the default, so a story
with no metadata block at all is an unbuilt one.

`status` says nothing about tests. Coverage is reported by the script below.

`url` is the page the story happens on, when there is one page. Omit it for
stories that span several pages or happen at a terminal.

## Writing a story

A story is one user intent, start to finish, told as a narrative. Say what the
user wants, what they do, and what they end up with. Two to six sentences is
usually right. If a story needs more than a short second paragraph, it is
probably two intents.

**Failure is part of the story, not a story of its own.** Nobody wants to see an
error message. They want to log in, and they mistype the password on the way.
Write the mistake into the narrative of the thing the user was trying to do, so
one story covers the happy path and the messages that guard it. A story titled
"fail to..." or "be refused..." is a sign that a story got split in half.

Name the promise, not the mechanism. "The slot keeps its identity and its events"
is a promise. "The `slug` column is the sync key" is an implementation note and
belongs in `GLOSSARY.md` or a spec.

Use the vocabulary from `GLOSSARY.md`. Course URL, Invite, Passphrase and
Permission pair are defined terms, and paraphrasing them here is how the shared
vocabulary quietly dies.

## Tests

Story tests live in `test/stories/`, one file per role and section, and drive the
web UI the way the user would. `test/stories/README.md` covers how to write them.

A test is linked to its story by name. Prefix the test with the role and use the
story title:

```ts
test("student: log in", async ({ page }) => {
```

`pnpm run stories` slugifies both sides and writes `coverage.md` from the match.
Three flags read the same data without writing it:

| Flag | What it does |
| :--- | :--- |
| `--check` | Fails if a test names a story that does not exist, if a document has a slug collision, or if `coverage.md` is stale. Runs as part of `pnpm run lint`. |
| `--missing` | Lists the stories no test names, each with its `status`. A `[status: implemented]` line is a built feature with no test; a `[status: todo]` one has nothing to test yet. |
| `--covered` | Lists the stories a test names. |
| `--stale` | Lists the tests that name no story, which is what a renamed or deleted story leaves behind. |

Renaming a story breaks the build until the test is renamed with it, which is the
point, and `--stale` says which tests to rename. For the stories worth writing a
test for next, filter the unbuilt ones out:

```sh
pnpm run stories --missing | grep -v '\[status: todo\]'
```

Some stories exercise the codehood CLI, which is a separate Python program. Those
tests must call the real CLI rather than posting to the REST API themselves.
