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

`manage create-course <discipline-slug> <instructor> <edition>`
: Creates a course taught by `<instructor>` (a username). Creates the
  discipline first, prompting for its name, if `<discipline-slug>` doesn't
  exist yet. Prompts for description and term dates interactively. This is
  the only way to create a course until the CLI sync lands in 0.2.0.

### Courses

`manage create-edition <slug> [-n NAME]`
: Creates an academic edition (term). Prompts for the display name, if not
  given, and for the window during which new courses may be created for it.
  The slug is the token that appears in every course URL (`ada_2026-1`), so it
  must match `^[0-9]{4}(-([1-9][0-9]*|0))?$` and cannot be changed afterwards.

`manage create-course <discipline-slug> <instructor> <edition>`
: Creates a course, prompting for description and term dates, and creating the
  discipline if it does not exist yet. The edition must already exist — create
  it with `manage create-edition` first.

### Resources

`manage import-resources <discipline-slug> <instructor> <edition> <manifest> [--prune]`
: Imports a course's files, links, notes, and snippets from a YAML manifest
  shaped like the sync payload (see `dev/specs/to-do/resources.md`). Additive
  and update-in-place by default; `--prune` also deletes resources not named
  in the manifest. `contentHash` is computed locally, the way the CLI will.
  Exists because the CLI's own sync endpoints don't yet, and the web app is
  never allowed to author content.

