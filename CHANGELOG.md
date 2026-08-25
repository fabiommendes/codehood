# Changelog

## Unreleased

### Added

- Authentication and registration of new users: invite-only accounts (personal
  single-use invites and reusable classroom join codes), Argon2id password
  hashing, session-cookie login for the web app, and API-key login for the
  CLI/grading bots. Admin accounts are bootstrapped via `manage create-user`
  (or automatically in dev). See `docs/implemented/auth.md`.
