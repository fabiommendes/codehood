# Backlog

Those are issues and vague future plans for the Codehood project. Items in the
backlog are not necessarily prioritized or scheduled for implementation. Pick
the items in the BACKLOG and move them to the ROADMAP once a milestone is set
and a rough schedule is agreed upon for a set of backlog items.

Backlog items are categorized in sections, not on priority.

## Infrastructure

* Abstract e-mail provider interface. The provider is implemented via plugins.

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

