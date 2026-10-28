---
type: issue
status: active
tags: [mdq, questions, ordering, push]
relatedTo: [dev/specs/to-review/mdq-biblioteca.md]
---

# O servidor não aceita questões de ordenação

O `mdq` (spec, mdq-py, mdq-js e `mdq/solid`) já tem o tipo `ordering`, mas o
servidor o recusa: `questionDocument` (`src/mdq/index.ts`) deixa o tipo de
fora, o enum Prisma `QuestionType` não tem `ORDERING` e o `codehood push`
bloqueia o envio (`cli/codehood/push/run.py`).

Fix: adicionar `ORDERING` ao enum (vai numa migração de release), incluir
`OrderingQuestion` em `questionDocument` e `publicOrderingSchema` em
`src/mdq/public-schema.ts`, semear uma questão em `src/db/bootstrap.ts` e
tirar o bloqueio do CLI. O componente de `mdq/solid` já renderiza o tipo;
falta decidir como a ordem inicial (`pool`) é enviada quando o aluno não mexe.
