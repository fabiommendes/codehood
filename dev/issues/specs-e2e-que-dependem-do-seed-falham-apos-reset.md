---
type: issue
status: backlog
tags: [tests, e2e]
kind: bug
priority: medium
created: 2026-11-12
creator: claude
---

# Specs e2e que dependem do seed falham quando outro spec apaga o banco do worker

`test/run.ts` semeia o banco de teste uma vez (`prisma/seed.ts`) e cada worker de
e2e recebe uma cópia. Cerca de 36 specs e2e chamam `resetDatabase`
(`test/stories/helpers.ts`), que apaga todas as tabelas do banco do worker e não
semeia de novo. Alguns specs fazem login com as contas do seed e não criam dado
nenhum:

- `test/api-crud.spec.ts`
- `test/admin-guard.spec.ts`
- `test/api-public-refs.spec.ts`
- `test/action-inputs-course-ref.spec.ts`
- `test/action-results-no-raw-ids.spec.ts`

Quando um spec com `resetDatabase` roda antes de um desses no mesmo worker, o
login de `student`/`admin` falha e o arquivo inteiro fica vermelho. A ordem entre
arquivos e workers não é fixa (`AGENTS.md`, "Test scopes"), então a suíte passa
ou falha conforme a distribuição.

## Como reproduzir

```
TEST_E2E_WORKERS=1 pnpm exec tsx test/run.ts --scope=e2e \
  test/exam-answer-history-page.spec.ts test/api-public-refs.spec.ts
```

Visto em 2026-11-12: 22 falhas numa rodada completa (`api-crud` e
`admin-guard`), depois que um spec novo com `resetDatabase` caiu antes deles. A
correção daquele dia tirou o reset de três specs que não precisavam; o risco
continua para os demais.

## Correção provável

Uma das duas, para os cinco specs acima:

- criar os próprios usuários e dados (`seedUser`, factories), como os outros
  specs e2e; ou
- um helper `reseedDatabase` que rode o seed no banco do worker, chamado no
  `beforeAll` de quem depende do seed.

Vale também um teste que acuse a dependência: rodar cada um dos cinco depois de
um spec que apaga o banco, com `TEST_E2E_WORKERS=1`.
