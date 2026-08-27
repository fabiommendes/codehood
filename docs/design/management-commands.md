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
