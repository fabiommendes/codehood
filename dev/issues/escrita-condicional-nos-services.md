---
type: issue
status: backlog
tags: [services, api, rest, sync, concorrencia]
kind: task
priority: medium
created: 2026-11-12
creator: claude
---

# Escrita condicional em todos os services

## Problema

Nenhuma escrita verifica se a linha mudou desde que o chamador a leu. Não há
`If-Match`, ETag nem versão esperada em `src/`. Uma edição feita na web entre
o GET do preflight e o PUT de um `ch push` é sobrescrita sem aviso, e duas
abas da web gravando a mesma entidade se atropelam.

A decisão está em `dev/adr/0013-escrita-condicional-nos-services.md`. O motivo
está em `dev/rfc/sync-bidirecional.md`, seção "Corrida entre o preflight e o
PUT".

## O que fazer

1. `ServiceOpts` (`src/db/base-service.ts:10`) ganha
   `expectedUpdatedAt?: Date | null`.
2. Erro `PreconditionFailed` em `src/core/error.ts`, serializável, com o
   `updatedAt` atual. Resposta 412 em `src/core/error-response.ts`.
3. Helper único em `src/db/` que faz a checagem dentro da transação, usado por
   todos os services (`src/db/conditional-write.ts`: `guardedUpdate`,
   `guardedDelete`, `touch`). O `upsert` de cada service repassa a opção aos
   dois ramos: `null` exige o ramo de criação, `Date` exige o de atualização.
   O `upsert` genérico de `base-service.ts` foi removido (não tinha
   chamadores).
4. Todos os services com `update`, `upsert` ou `delete` em
   `src/db/services/` cujo modelo tem `updatedAt` passam a honrar a opção.
5. `Discipline` ganha `updatedAt` em `prisma/schema.prisma`. `Edition` fica
   de fora: só o administrador a edita. Um `If-Match` enviado a um service
   sem `updatedAt` é recusado com erro, não ignorado.
6. Auditoria por service: toda escrita que muda o read model muda o
   `updatedAt` da linha endereçada. Casos já conhecidos que não mudam hoje:
   - `Resource.event` anulado por `onDelete: SetNull` quando o evento é
     apagado;
   - feito: `tags` e `questions` do exame, nova `QuestionData` de uma
     questão, `repositories` de um evento e `values` de coluna de nota
     bumpam a linha mãe (T2 e T3a);
   - feito: item de rubrica bumpa a rubrica (`createItem`, `updateItem`,
     `upsertItem`, `deleteItem`, `splitItem`, `renameGroup`);
   - feito: recalcular a pontuação das notas da rubrica (`rubric.update`,
     valor de item) bumpa as notas alteradas; `deleteItem` bumpa as que
     aplicavam o item;
   - feito: nota nova que muda o status da submissão bumpa a resposta
     (`feedback.create`, `feedback.upsert`, `regradeRequest.accept`);
   - feito: `feedback.delete` bumpa o pedido de revisão aceito com a nota
     (`feedbackId` anulado por cascata).
7. `CRUD()` (`src/api/`) lê `If-Match` e `If-None-Match: *` em `PUT`, `PATCH`
   e `DELETE`, e os declara no OpenAPI. Regenerar o snapshot e o cliente da
   CLI com `pnpm run openapi:cli`.
8. As Astro Actions que editam uma entidade enviam o `updatedAt` carregado
   pela página.
9. Atualizar `dev/rfc/como-criar-e-escrever-um-service.md` com a regra.

## Restrições

- Só começar depois que a fatia T7 do histórico de edição de respostas entrar
  em `main`: até lá `src/db/services/answer-edit.service.ts` e o schema ainda
  mudam.
- `db.answerEdit` fica fora da regra. Ele não tem `update`, `upsert` nem
  `delete` públicos, e `append` já faz compare-and-swap em
  `AnswerEditField.revision`. O `updatedAt` de `AnswerEditHistory` e de
  `AnswerEditField` é contabilidade, não versão.
- `Exam.answerHistory` é estado só do servidor e continua fora dos corpos de
  criação e atualização (`test/api-exam.spec.ts`,
  `test/openapi-snapshot.spec.ts`).

## Critérios de aceitação

- Para cada service com escrita, um teste `unit`: `expectedUpdatedAt` correto
  grava; desatualizado lança `PreconditionFailed` e não grava; ausente grava.
- `upsert` com `null` cria quando a linha não existe e falha quando existe.
- Um teste percorre os services registrados e falha se algum tiver `update`,
  `upsert` ou `delete` sobre um modelo com `updatedAt` sem honrar a opção,
  para um service novo não nascer sem ela.
- `e2e`: `PUT` com `If-Match` desatualizado responde 412 e o corpo traz o
  `updatedAt` atual; sem o cabeçalho, o comportamento de hoje.
- Apagar um evento muda o `updatedAt` dos recursos que apontavam para ele.

## Fora do escopo

O uso do cabeçalho pela CLI. Fica com a implementação do sync bidirecional.
