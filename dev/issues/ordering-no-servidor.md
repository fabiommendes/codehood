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
tirar o bloqueio do CLI. O componente de `mdq/solid` já renderiza o tipo.

Decidido no mdq (commits 7fefba8, 0990a55, 4753bbb do mdq-spec):

- A forma pública ganha `maxLevel?` (só com `indentation` lenient ou strict).
- Enquanto o aluno não responde, o componente mostra o `pool` com um aviso e
  um botão "Keep this order", que envia a ordem intacta por `onChange`.
  `value={null}` controlado significa "ainda sem resposta".
- Lado do host: se o aluno entrega a prova com a questão ainda sem resposta,
  o codehood pergunta num diálogo se ela deve ser pulada.
