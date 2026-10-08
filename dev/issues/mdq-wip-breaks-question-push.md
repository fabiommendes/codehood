---
type: issue
status: active
tags: [cli, mdq, questions, push]
relatedTo: [mdq-py, push-questions]
---

# Uncommitted mdq-py changes break the CLI's question push

The CLI takes `mdq` from the sibling checkout `../../mdq/mdq-py`, which has
uncommitted work that changes the question models:

- `shuffle` becomes `bool | "inherit"`. A pushed question sends
  `"shuffle": "inherit"` and the server rejects it with 400
  (`question.shuffle: expected boolean, received string`).
- `openEnded` is gone from short-answer questions.

Failing tests in `cli/`:

- `tests/test_push_run.py::test_run_plan_upsert_question_short_answer_keeps_camel_case_aliases`
  (`KeyError: 'openEnded'`).
- `tests/test_push_integration.py::test_push_questions_matches_the_repository_exactly_and_reconverges`
  (400 on every question).

Fix: when the mdq change lands, update the server's question schemas
(`src/mdq/schemas-generated.ts`) or drop `"inherit"` in the CLI before sending,
and update the short-answer test.
