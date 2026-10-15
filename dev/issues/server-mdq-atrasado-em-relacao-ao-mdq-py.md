---
type: issue
status: active
tags: [mdq, questions, push, cli, server]
relatedTo: [mdq-py, push-questions]
---

# O servidor usa uma cópia antiga do formato MDQ

`public/mdq.schema.json` e `src/mdq/schemas-generated.ts` datam de 5 de
setembro. O `mdq-spec` atual (`mdq/schema/mdq.schema.json`) mudou bastante, e
o `codehood push` só funciona porque `cli/codehood/push/wire.py` traduz a
questão do `mdq-py` para o formato antigo. Tudo o que a tradução descarta se
perde no servidor, que corrige com os campos que conhece.

## O que quebra o push hoje

- Tipo `ordering`: o servidor não tem. O CLI recusa a questão (`blocked`) sem
  enviar nada. No curso `paradigmas` são 14 questões, e o `push` termina com
  código 1. Exige tipo novo em `src/mdq/`, `src/core/schemas/question.ts`,
  pontuação, visões de questão/resposta/correção, `bootstrap.ts` e testes.
- Gerador `scripts/generate-question-models.ts` não aceita o schema novo
  (`No example for pattern ... in Numeric.answer[1]`): precisa de
  `PATTERN_EXAMPLES` e do suporte a `oneOf` com string.

## O que a tradução do CLI perde

- `diacritics` (padrão `fold`): o servidor compara com acento. `Brasilia`
  não casa com `Brasília`, o contrário do que o `mdq-py` decide.
- `unmatched`, `incorrectFeedback`, `grading` e `weight`.
- Em lacunas de resposta curta: `reject`, `preAccept`, `preReject`, e o
  `feedback` de cada padrão de `accept` (vira `oneOf`, só texto).
- `shuffle: "inherit"` é omitido (fora de prova vale `false`).

## Questões do corpus do `mdq-spec` que o servidor recusa (400)

- `numeric` com `answer` em texto (`"1/3"`, inteiro fora de 32 bits, decimal
  que o float não guarda): `question.answer: expected number, received string`.
- `unit` com caracteres fora de `[\w.-]` (por exemplo `m/s`).
- `id` fora de `^[a-zA-Z0-9]+(?:[-_][a-zA-Z0-9]+)*$`.

Fix: regenerar `public/mdq.schema.json` a partir do `mdq-spec`, adaptar
`src/mdq/` e implementar `ordering`. Depois, remover as traduções de
`wire.py` que deixarem de ser necessárias. Qualquer correção no servidor só
chega à produção com um release novo.
