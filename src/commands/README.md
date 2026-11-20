# Management commands

Uses Commander.js to write simple management scripts for the server. Each
command (or group of commands) is a separate file in `src/commands/`. The
command files are loaded by `src/commands/index.ts` and registered with the
`manage` CLI tool.

For example, the file `src/commands/create-user.ts` implements the `manage
create-user` command. Commands should access functionality through the service
layer, not directly through the database.

Whenever a new command is created, document it in this file.


## Commands

### Authentication

`manage create-user <user> [-r ROLE]`
: Creates a user with a given role and password. Ask for password, password
  confirmation and additional fields (e.g. name) interactively. If email is not
  provided, ask for it interactively.

`manage reset-password <user>`
: Resets the password for a given user. Ask for password and password   
  confirmation interactively. 

### Courses

`manage create-edition <slug> [-n NAME]`
: Creates an academic edition (term). Prompts for the display name, if not
  given, and for the window during which new courses may be created for it.
  The slug is the token that appears in every course URL (`ada_2026-1`), so it
  must match `^[0-9]{4}(-([1-9][0-9]?|0))?$` and cannot be changed afterwards.

`manage create-course <discipline-slug> <instructor> <edition>`
: Creates a course taught by `<instructor>` (a username). Creates the
  discipline first, prompting for its name, if `<discipline-slug>` doesn't
  exist yet. Prompts for description and term dates interactively. The edition
  must already exist — create it with `manage create-edition` first.

### Resources

`manage import-resources <discipline-slug> <instructor> <edition> <manifest> [--prune]`
: Imports a course's files, links, notes, and snippets from a YAML manifest
  shaped like the sync payload. Additive
  and update-in-place by default; `--prune` also deletes resources not named
  in the manifest. `contentHash` is computed locally, the way the CLI will.
  Exists because the CLI's own sync endpoints don't yet, and the web app is
  never allowed to author content.

`manage import-calendar <discipline-slug> <instructor> <edition> <manifest>`
: Imports calendar events for a course from a YAML manifest shaped like the
  sync payload.

`manage recompute-event-times`
: Recomputes every calendar event's start and duration from its course's
  start, its time slot and its week. Repairs events written under an older
  rule; running it again changes nothing.

### Questions

`manage upgrade-questions [--dry-run]`
: Rewrites the question versions stored by Codehood 0.2 (public and private
  halves split, `preamble`, essay `input`, short answer `oneOf`) as the
  current mdq document and its public form. Versions already current are left
  alone; running it again changes nothing. Exits with 1 when a version cannot
  be converted, naming it.

### Grading

`manage grade-objectives --course <course> [--exam <exam>] [--dry-run] [--released]`
: Grades the objective answers (multiple choice, selection, numeric and the
  like) of the attempts that are closed or out of time and have no grade yet,
  which is what the server does when an attempt closes. Essays, code and
  fill-ins with a blank for the instructor stay as they are. It looks at
  exams whose grades were not released, plus the released ones with
  `--released`, whose students would see a grade appear. `--dry-run` prints
  what it would grade and writes nothing. Run it per exam, with `--dry-run`
  first.

`manage settle-cancelled-sends --course <course> [--dry-run]`
: Marks as `WILL_NOT_GRADE` the code sends whose grading job was cancelled
  because the student sent again, and that still wait for a grade without
  any pass. Servers before 0.7.1 left them pending, which kept their question
  pending and the exam's grades from being released. Sends graded by hand
  stay as they are. Running it again changes nothing.

### Enrollments

`manage check-instructor-enrollments [--fix]`
: Lists the enrollments whose user is the instructor of the course, with their
  attempt count, and exits 1 when any is left. `--fix` deletes the ones without
  attempts; the others need a manual decision.

### Team repositories

`manage prune-team-repositories [--dry-run]`
: Removes the folders of `REPOSITORY_ROOT` named `<id>.git` whose id belongs to
  no team, such as the leftovers of a team deleted while the disk failed.
  Leaves `_hooks`, any other name and loose files alone; a symlink is removed
  as a link. `--dry-run` lists what it would remove and deletes nothing.

### Answer edit history

`manage answer-history-stats <course> [exam] [--json]`
: Prints, for each exam of `<course>` (`discipline/instructor_edition`, e.g.
  `cs101/ada_2026-2`) or only for `[exam]`, how much edit history of answers it
  holds: attempts, attempts with history, incomplete ones, edits, the bytes the
  history counts against its limit (`counted bytes`), the bytes it stores
  (`stored bytes`, an estimate that leaves out indexes and free space of
  pages), and the median and maximum of `stored bytes` per attempt. The last
  line is the total. `--json` prints the same as one line of JSON. Read only.
