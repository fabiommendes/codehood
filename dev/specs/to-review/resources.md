# Course resources

`Resource` and `File` are in the schema and nothing writes them; `/<course>/resources`
renders six hardcoded rows behind a "Preview data" alert. This spec makes the
tab real: the model, `ResourceService`, the route that serves a blob, and the
page.

A resource is one of four things a course hands its students — a **file** to
download, a **link** to follow, a **note** to read, or a **snippet** to copy.
They live in one table because they are one list on one page, and the type
decides only what a row does when you click it.

## Scope

- `Resource` gains `slug`, `contentHash`, `updatedAt`, and a `CODE` type;
  `File` gains `deletedAt`.
- `ResourceService` and `FileService` in `src/db/`, full CRUD per
  `docs/design/db-service-classes.md`.
- `/files/<slugHash>/<name>` — the blob route, and the tombstone it serves
  when the bytes are gone (FR-SYNC-013, FR-SYNC-015).
- `/<discipline>/<course>/resources`, grouped by type, replacing the mock.
- `/<discipline>/<course>/resources/<slug>` for notes and snippets, which have
  content to render rather than a destination to go to.
- `manage import-resources`, since the CLI does not exist yet and the web app is
  never allowed to author content.
- Demo resources in `ensureDemoCourses`, one of each type.

Out of scope: the REST sync endpoints and the base64 ingest (FR-SYNC-020), which
belong to the sync spec; a `private` flag for resources (FR-NFR-032 says the
feature does not exist yet, and adding it here would imply a protection this
design cannot give); and `FileForUser`, the avatar half of FR-NFR-033.

## Design decisions

### The page groups by type, and order is never authored

```
Resources

  Files
  ├ 📄 Slides 01                  PDF · 1.2 MB
  ├ 📄 Slides 02                  PDF · 900 KB
  └ 📄 Syllabus                   PDF · 240 KB

  Links
  └ 🔗 SICP, chapter 1            external

  Notes
  └ 📝 Setting up your toolchain  markdown

  Snippets
  └ 💻 factorial.py               python
```

Four groups in a fixed order — `FILE` → Files, `LINK` → Links, `MD` → Notes,
`CODE` → Snippets — each sorted by title, each hidden when empty.

No `position` column and no `section`. A resource list is a place you *look
something up*, not a sequence you work through — the sequence is the calendar,
which is already dated and already ordered. Grouping by type means "where is the
syllabus" is answered by scanning one short group, and it means the model has no
ordering to keep in sync with a repository that could reorder a directory
listing for reasons of its own.

This is reversible without moving data: a `position Int` added later changes the
sort and nothing else. Authored sections would not be reversible in the same
way, which is why they are not the default.

### `CODE` joins the enum, and `extra` finally has a job

The model's doc comment already describes four variants and `extra` exists to
hold a code resource's language, but `ResourceType` stops at three. The enum
gains `CODE`:

| Type | `data` | `extra` | `fileId` | Row action |
| :--- | :--- | :--- | :--- | :--- |
| `LINK` | the URL | — | — | navigates away |
| `FILE` | — | — | the blob | downloads |
| `MD` | the markdown | — | — | opens its own page |
| `CODE` | the source | the language | — | opens its own page |

A snippet is not "markdown with a fence around it": it has a language the page
can highlight without parsing for it, a filename-shaped title, and a copy
button, and modelling it as prose would throw all three away at ingest.

`extra` stays a loose `String?` and the language is not validated against a
list. An unknown language falls back to plaintext highlighting. The server
refusing content because it cannot pretty-print it would be the server having an
opinion about content, which is the line `FR-SYNC-021` draws.

### Pushed means visible

There is no `status` and no `visibleFrom`. Everything the repository holds is
visible to everyone who may see the course's contents (FR-CRS-032): enrolled
students, the course's instructor, and — for reading only — an admin.

Staging happens in Git. An instructor who does not want next week's slides seen
yet does not push them yet, which is a decision they make in the tool they are
already in, with no second concept of "on the server but not really".

The consequence to be honest about: **the resources page is enrolled-only, and
the file URL is not.** FR-NFR-030 has the reverse proxy serve blobs with no
authentication check, and FR-NFR-031 makes that access unrevocable. So "visible
to enrolled students" describes the *listing*; anyone who learns a blob URL has
the blob permanently, including after they drop the course. FR-NFR-032 is the
rule that makes this acceptable — nothing whose disclosure matters goes in a
resource — and the page says so where an instructor will read it, on the
resources empty state and in `manage import-resources`'s output.

### Files are content-addressed, and that has two consequences

`File.slugHash` is a hash of the bytes. It is the URL token and it is the
storage location, and `filename` and `path` are gone from the model because both
are derivable or unnecessary: the path is `<RESOURCE_ROOT>/<hash[0:2]>/<hash>`,
and the download name comes from the resource that links to the blob.

**Consequence one: the same bytes are one blob.** Two courses pushing the same
PDF collide on `slugHash` and share a row — `File.resources` is already a list,
so the model expects it. That makes `ResourceService.delete` a reference-counted
operation: removing a resource never removes bytes another resource still points
at, and `FileService.delete` only reaches the disk when the last reference goes.
It also makes a re-push of unchanged bytes a genuine no-op, which is what
FR-SYNC-003's idempotence wants.

**Consequence two: the URL is guessable for guessable content.** A content hash
of a public PDF, of last year's handout, or of a file a student already holds is
computable, and so is its URL. `FR-NFR-030` says the token must be
"unguessable", and a content hash is not — so **that requirement needs
amending** to say "addressed by its content hash and served without an
authentication check", which is what this design actually does.

The amendment is defensible rather than a papering-over, because FR-NFR-032
already forbids putting anything whose disclosure matters into a resource, and
FR-NFR-031 already treats every resource URL as permanently public. Guessability
changes *who* can reach a non-secret file from "anyone given the link" to
"anyone with the same file", and the threat model already accepted the first.
What it rules out permanently is ever using this route for something private:
the `private` flag in the follow-ups would need a different addressing scheme,
not just an auth check.

If unguessability is later wanted without losing dedupe, the one-field version
is an `urlToken` alongside `slugHash` — random for the URL, content hash for
storage. Not built, because it buys nothing until something private exists.

**The download name.** With `filename` gone, `Content-Disposition` takes its
name from the linking `Resource.title`, slugified, with the extension implied by
`mimeType`. The blob URL carries it as a trailing decorative segment —
`/files/<slugHash>/slides-01.pdf` — which the route ignores when resolving and
uses only when the segment is absent. A blob shared by two resources therefore
downloads under whichever name the student clicked, which is the right answer:
the name belongs to the use, not to the bytes.

Nothing user-supplied reaches the filesystem path at all now, since the path is
a hash and the title never leaves the header.

**Who computes it.** The server, from the bytes it receives — it has to, in
order to store them, and hashing bytes is addressing rather than having an
opinion about content (`FR-SYNC-021`). If the CLI sends its own hash alongside,
the server compares and rejects a mismatch as a corrupt upload. That is the one
place a hash is checked rather than trusted, and it costs nothing.

`files` joins `RESERVED_SLUGS` in the same commit, and the system-route table in
`docs/design/url-structure.md` — FR-CRS-004, and the failure is silent.

### Serving a blob: an allowlist, not a blocklist

`ResourceType.FILE`'s own comment sets the rule — "if the file is a supported
media type (image, audio, video, pdf), it will be displayed inline in the
browser" — and the safe way to implement that sentence is as an allowlist:

- `Content-Disposition: inline` for `image/*` except `image/svg+xml`, `audio/*`,
  `video/*`, and `application/pdf`. Everything else, including every type the
  server has not heard of, is `attachment`.
- `X-Content-Type-Options: nosniff`, always.

An allowlist rather than "inline except HTML and SVG", because the blob sits on
the app's own origin with no auth in front of it, and a blocklist is a list of
the dangerous types somebody thought of. An instructor pushing an `.html` file
is otherwise pushing a script that runs on the origin holding every student's
session cookie; SVG is the same hazard wearing an image's MIME type, which is
why it is carved out of `image/*` explicitly.

Pages that link to resources send `Referrer-Policy: no-referrer`. FR-NFR-031
lists the `Referer` leak as an accepted consequence; it is accepted because it
cannot be eliminated, not because it should not be reduced, and one header
reduces it.

### A deleted file keeps its row and answers for itself

FR-SYNC-013 deletes the blob and retains the URL as a tombstone; FR-SYNC-015
requires it to explain itself rather than 404.

`File` gains `deletedAt DateTime?` — the one column this spec asks for that the
schema does not have yet, and it is not optional: without it a removed blob is
indistinguishable from a hash that never existed, and FR-SYNC-015 requires the
two to answer differently.

Deleting removes the bytes from disk and stamps the column; the row and its
`slugHash` stay. It only happens when the **last** resource pointing at the blob
goes, since content addressing means two courses may share it — a delete in one
course that silently emptied another course's syllabus would be the worst
possible bug to find by report.

**The `Resource` row does not stay.** `ResourceService.delete` removes it
outright, the same as a calendar event, and the list gets shorter. The tombstone
lives one level down, on `File`: the row and its `slugHash` survive, so a link
already pasted into a chat, a bookmark, or a student's notes answers for itself
instead of 404ing. That is what FR-SYNC-013's "URL retained as a tombstone"
asks for — the URL is the blob's, not the listing's.

An earlier draft of this section said the opposite, keeping a struck-through row
on the page. Both readings satisfy FR-SYNC-015; this one is the decision.

Serving falls through: the proxy tries the file, misses, and hands the request
to the app, which looks up `slugHash` and answers `410 Gone` — naming any
resource still pointing at it, which after an ordinary delete is none, so the
page says the file was removed by the instructor and nothing more. A token
matching no row answers `404`, the only case where saying nothing is right. The `try_files … @app` line is part of this change, not a deployment
detail discovered later.

### Markdown is rendered with HTML off

Notes render server-side with `markdown-it`, `html: false`. Raw HTML in a note
would run on the app's origin, and "the instructor is trusted" is not a security
boundary when the instructor is pushing files from a repository a teaching
assistant may also commit to.

Snippets render with Shiki, using `extra` as the language and plaintext as the
fallback. Both are view-layer concerns: `FR-SYNC-021` forbids the server
parsing or transforming resource content *on the way in*, and nothing here
touches what is stored — the row keeps exactly the text that was pushed.

### `ResourceService` and `FileService`

Two services, because a blob outlives the resource that points at it and can be
pointed at by more than one (`File.resources` is already a list).

```ts
interface CreateResource {
  courseId: number;
  slug: string;                  // natural key from the path — FR-SYNC-010
  type: ResourceType;
  title: string;
  description?: string;
  data?: string;                 // url | markdown | source
  extra?: string;                // language, for CODE
  fileId?: number;
  contentHash: string;           // supplied by the writer, stored verbatim
}

interface FindResourcesBy {
  courseId?: number;
  types?: ResourceType[];
  slugs?: string[];
}
```

`@@unique([courseId, slug])` is the natural key the sync endpoints will resolve
(FR-SYNC-010), and renaming a file in the repository is a delete plus a create
(FR-SYNC-011). `contentHash` follows the rule the calendar and question specs
already set: supplied on every write, opaque, never computed or normalized by
the server, because only the writer can see the file it describes.

The service validates the shape the type implies — a `LINK` with no `data` is
refused, so is a `FILE` with no `fileId`, so is a `CODE` with no `extra` — and
refuses a `data` that is a URL for anything but `LINK`. Four variants in one
table is a denormalization (the model's own comment says so), and the service is
where the union is enforced.

`ResourceService.delete` removes the row outright, matching FR-SYNC-013's
"deleted" row for calendar events. `FileService.delete` is the soft one, above.

Reads use `canViewCourseContents`, writes `canWriteCourseContent` — the same
pair the calendar spec introduces, with no admin branch on the write side
(FR-ACC-010). Both services implement the `*As` interfaces.

### `manage import-resources`, shaped like the sync payload

```
manage import-resources cs101 ada 2026-1 ./resources.yaml
```

```yaml
resources:
  - slug: syllabus
    type: FILE
    title: Syllabus
    description: Grading, schedule, and course policy.
    file: ./files/syllabus.pdf        # read from disk, hashed, stored
  - slug: sicp-ch1
    type: LINK
    title: SICP, chapter 1
    data: https://example.com/sicp/ch1
  - slug: toolchain
    type: MD
    title: Setting up your toolchain
    data: |
      Install Node 22 and `pnpm`, then run `pnpm dev`.
  - slug: factorial
    type: CODE
    title: factorial.py
    extra: python
    data: |
      def factorial(n):
          return 1 if n <= 1 else n * factorial(n - 1)
```

`--prune` deletes resources not named in the file; without it the import is
additive and updates in place by slug. The command computes each resource's
`contentHash` locally, the way the CLI will, and prints the blob URLs it created
alongside the reminder that they are public forever.

### The page, and what an instructor sees on it

One page for everyone. An instructor gets no badge, no toggle, and no second
view — what they get is the empty state telling them the push command, and file
sizes with a total, which is the only number on this page that is theirs rather
than the students'.

Notes and snippets get their own page at `/<course>/resources/<slug>`, since
they have content rather than a destination; the row links there, and the page
carries the same `CourseHeader` with `resources` active. Links and files act
from the row itself.

## Schema

```prisma
enum ResourceType { LINK FILE MD CODE }

model Resource {
  id   Int          @id @default(autoincrement())
  type ResourceType

  courseId Int
  course   Course @relation(fields: [courseId], references: [id], onDelete: Cascade)

  /// Natural key from the repository path — FR-SYNC-010.
  slug String

  title       String
  description String?

  /// URL for LINK, markdown for MD, source for CODE. Null for FILE.
  data String?
  /// Language for CODE. Null otherwise.
  extra String?

  fileId Int?
  file   File? @relation(fields: [fileId], references: [id])

  /// Supplied by the writer, opaque to the server.
  contentHash String

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([courseId, slug])
  @@index([courseId, type])
}

model File {
  id       Int    @id @default(autoincrement())
  slugHash String @unique   // sha-256 of the bytes; URL token and storage path
  mimeType String
  size     Int

  /// Set when the bytes are removed; the row survives as a tombstone (FR-SYNC-013).
  deletedAt DateTime?

  createdAt DateTime   @default(now())
  resources Resource[]
}
```

Relative to the schema as it stands: `Resource` gains `slug`, `contentHash`,
`updatedAt`, the unique key, the index, and `onDelete: Cascade` on its course;
`File` gains `deletedAt`. `ResourceType` and the four-variant shape of
`Resource` are already there. Both tables are empty, so this is a create.

`Resource.contentHash` stays even though `File.slugHash` already hashes a blob's
bytes: it covers the title, description, and type that the file does not, and
the other three types have no file at all. For a `FILE` resource the two will
usually move together, and the server relies on neither to detect the other.

`Resource` is the `FileForCourse` join FR-NFR-033 asks for — a use-linking table
rather than a foreign key on `File` — so no separate model is needed for the
course case.

## Tests

`test/resource-service.spec.ts`:

- Each type's shape rule: a `LINK` without `data`, a `FILE` without `fileId`, a
  `CODE` without `extra`, and an `MD` carrying a `fileId` are all refused.
- `create` rejects a duplicate slug in one course and accepts the same slug in
  another.
- `create` rejects a missing `contentHash` and stores a supplied one verbatim.
- `findMany` returns the four groups' worth of rows and the page's ordering is
  reproducible: type order fixed, title order within it, empty groups absent.
- An enrolled student sees a course's resources; a dropped student sees none; a
  non-owning admin reads them and cannot write them.
- `delete` removes the resource row; the `File` it pointed at survives, because
  another resource may still point at it.

`test/file-service.spec.ts`:

- Two uploads of identical bytes produce one row, one `slugHash`, and one file
  on disk; two resources may point at it from different courses.
- A CLI-supplied hash that disagrees with the bytes is rejected as corrupt.
- The stored path is derived from `slugHash` alone, and no request field reaches
  it — asserted with a resource title containing `../`.
- `delete` on a blob with two references removes neither the bytes nor the row;
  removing the second reference removes the bytes, keeps the row, and stamps
  `deletedAt`.
- A tombstoned file resolves to `410` naming the resource; an unknown token
  resolves to `404`.
- `application/pdf`, `image/png`, `audio/mpeg`, and `video/mp4` are served
  `inline`; `text/html`, `image/svg+xml`, and an unrecognized
  `application/x-thing` are served `attachment`; all carry `nosniff`.
- The download name comes from the linking resource's title, and a blob shared
  by two resources downloads under whichever one was clicked.

Evidence: screenshots of the four groups populated from `ensureDemoCourses`, a
note and a snippet page, and the tombstone page for a deleted file.

## Documentation to update in the same change

- `src/utils/course-url.ts`: `files` joins `RESERVED_SLUGS` (FR-CRS-004).
- `docs/design/url-structure.md`: `/files/<slugHash>/<name>` and
  `/<course>/resources/<slug>` join the route tables.
- `GLOSSARY.md`: `Resource` and `Resource tombstone` entries.
- `dev/requirements/08-nonfunctional.md`: **FR-NFR-030 needs amending** — it
  says "unguessable slug hash", and a content hash is not unguessable. The
  wording should describe what the design does: addressed by its content hash,
  served without an authentication check.
- The deployment notes need the `try_files … @app` fallback and the
  `RESOURCE_ROOT` setting; there is no deployment doc yet, so this spec is
  where they live until there is.

## Deployment notes

There is no deployment doc yet, so this is where these two settings live until
there is one:

- `RESOURCE_ROOT` — the directory blobs are written under, as
  `<RESOURCE_ROOT>/<hash[0:2]>/<hash>` (`src/constants.ts`). Defaults to
  `./storage/resources`, next to the SQLite database, so a fresh checkout
  works with no setup; production should point it at a persistent volume.
- The reverse proxy in front of the app should `try_files` a blob's path under
  `RESOURCE_ROOT` before falling back to the app (`@app` in nginx terms). That
  is what makes "served directly by the reverse proxy" (FR-NFR-030) true for
  the common case — the app itself always can serve a blob too (it has to,
  for the `410` tombstone case), so the fallback is a performance win, not a
  correctness requirement. Not configured in this repository, since there is
  no reverse-proxy config in it yet.

## Follow-up, not in this spec

- **REST sync endpoints** and base64 ingest (FR-SYNC-020), with the size ceiling
  the 40 MB slide deck in `08-nonfunctional.md` implies.
- **A `private` flag** (FR-NFR-032), which needs the blob route to authenticate
  *and* an address that is not the content hash — a different deployment shape
  and a second token, not a column.
- **An `urlToken` beside `slugHash`**, if unguessable URLs are ever wanted
  without giving up dedupe.
- **`FileForUser`** for avatars, the other half of FR-NFR-033.
- **Ordering**, if grouping by type turns out not to be enough. `position Int`,
  sorted before title, and nothing else changes.
- **Serving blobs from a separate origin**, which would make the `attachment`
  rule above a defence in depth rather than the only one.
