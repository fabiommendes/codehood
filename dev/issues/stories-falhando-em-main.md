---
type: issue
status: open
tags: [tests, stories]
created: 2026-11-06
creator: claude
---

# Três stories falham em `main` (2bfdd24)

Encontradas ao rodar a suíte na branch `feat/client-runner`. Confirmado que
falham igual no commit base `2bfdd24`, sem relação com o runner.

- `test/stories/instructor-questions-and-exams.test.ts:230` (bot): o texto
  "New key created. Copy it now. It won't be shown again." (linha 247) não
  aparece.
- `test/stories/student-exams.test.ts:17`: o teste espera `/can['’]t/`, mas
  o diálogo de confirmação diz "You won't be able to change...".
- `test/stories/student-finding-course-material.test.ts:374`: "Recursion
  quiz" não aparece na região "Upcoming" do calendário (provável
  dependência da data do seed).

Corrigir em `main`, não na branch do runner, para não misturar os históricos.
