# Backlog

Those are issues and vague future plans for the Codehood project. Items in the
backlog are not necessarily prioritized or scheduled for implementation. Pick
the items in the BACKLOG and move them to the ROADMAP once a milestone is set
and a rough schedule is agreed upon for a set of backlog items.

Backlog items are categorized in sections, not on priority.

## Small issues

None now!

## Features

* [ ] The Essay question should use a rich text editor component for better
  content formatting. Investigate suitable rich text editor libraries and
  integrate it in the component. It should provide a user-friendly interface
  and a raw markdown mode for advanced users.
* [ ] The Essay question should support a code editor textarea for code
  questions. I lean towards using Monaco, but we should evaluate pros and cons
  before making a final decision.



## Maintainability

* **Permanent:** go through all `any` types and replace them with more specific
  types where possible. We can use advanced TypeScript features and the module
  `utils/types.ts` have great helpers. If `any` can't be avoided, create a type
  alias with a descriptive name for that use and add a comment explaining why
  that `any` is necessary.
* **Permanent:** go through the FIXME/TODO items. If it is an easy fix, fix it.
  Otherwise, remove the comment and save it in the corresponding section in the
  backlog.
* **Permanent:** review all code comments and ensure they are up-to-date and
  relevant. Refactors can make comment drift, so we need to keep them in sync
  with the code. If a comment is no longer relevant, remove it. If a comment is
  unclear or incomplete, update it to provide accurate information. If the
  comment is too long or complex, consider making a summary or breaking it into
  smaller comments. Documentation facing comments (TSDoc) should be kept
  especially accurate and up-to-date. TSDocs never refer to planning
  discussions, temporary notes or documents under /dev/. If the reference is
  relevant to understanding the implementation, break the comment in two: the
  main TSDoc comment for the public API, and a separate `//` comment for the
  implementation details and decisions.
* **Permanent:** fix any typos and grammatical errors throughout the codebase,
  including comments, documentation, and variable and function names. Make
  sure not breaking any call site when editing the later two.


## Infrastructure

* Implement email providers with plugins. 

## Auth

* E-mail password reset flow.
* OAuth2 login.
* 2FA (TOTP) for instructors and admins.

## Localization

* **English and Brazilian Portuguese UI (FR-NFR-021).** Every screen is
  hardcoded English today, `src/i18n/` does not exist, and the calendar,
  course-tabs, and question specs each add more strings. Interface strings only
  — course content stays whatever language the instructor wrote (FR-NFR-022),
  and the locale is a server-wide setting, not per user. Deferred deliberately:
  doing it late costs a sweep over the strings, doing it now costs it on every
  screen before the screens are settled.

## Questions and exams

* **Question weights (FR-QST-030 … FR-QST-032).** `QuestionsForExam.weight
  Float?` defaulting to 1, the `Σ(weight × score) / Σ(weight)` score, and the
  rule that weights freeze while an exam is `ONGOING`. Cut from
  `dev/specs/to-do/questions.md`: they live on the exam side of the join table
  and mean nothing until an exam can be taken.
* **Version pins (FR-QST-014).** An unset pin means `QuestionRef.latest` and
  must not be user-settable. Note that `FR-QST-014` says the server stamps it at
  `SCHEDULED` while `FR-EXAM-013` says at `ONGOING`; the two requirements
  disagree and the exam slice has to settle it.

