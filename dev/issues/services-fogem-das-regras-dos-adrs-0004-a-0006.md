---
type: issue
status: backlog
tags: [db, services, auth]
relatedTo: [0004-services-sao-a-unica-porta-de-acesso-ao-banco, 0005-actor-obrigatorio-em-toda-chamada-de-service, 0006-validacao-de-entrada-e-saida-nos-services]
kind: defect
priority: high
created: 2026-11-03
creator: claude
---

# Services fogem das regras dos ADRs 0004 a 0006

Ao transformar `src/db/services/README.md` nos ADRs 0004 a 0006, a comparação
com o código achou métodos que não seguem as regras.

## Problema

**`opts?` no lugar de `opts` (ADR 0005, fail-open):**

- `src/db/services/discipline.service.ts:90`, `:105` (`findOne`, `findMany`)
- `src/db/services/edition.service.ts:85`, `:98` (`findOne`, `findMany`)
- `src/db/services/blob.service.ts:116`, `:129` (`findOne`, `findMany`)
- `src/db/services/attachment.service.ts:153`, `:174`, `:375`, `:395`
- `api-key.service.ts:130` e `session.service.ts:87` (`validate`): exceções
  legítimas (estabelecem a identidade), já documentadas no doc comment.

**Métodos públicos sem `@Validate` (ADR 0006):** api-key `validate`, `delete`,
`update`, `upsert`; attachment `detach`, `allAttachedTo`, `usageBytes`; blob
`createFromFile`, `collectGarbage`; calendar-event `recomputeTimes`; invite
`redeem`; passphrase `redeem`; report `countOpen`; repository `findByToken`,
`readObject`; session `validate`, `upsert`. Sem `returns:`: user
`:288`, `:330`, `:358`, report `attachment` (`:325`).

**`findMany` que filtra em silêncio (ADR 0005):**
`src/db/services/report.service.ts:238` usa `hasPerm` para descartar registros
em vez de `ensurePerm` para afirmar.

**Prisma fora de um Service (ADR 0004):**
`src/api/registry/crud.ts:534` (`assertScopeExists`) consulta `prisma.course`
direto, sem actor.

**Interface CRUD incompleta (ADR 0004):** `AttachmentService` e `BlobService`
não implementam as interfaces; `SessionService` não tem `findOne`, `findMany`
nem `update`; `RepositoryService` declara `update: never` sem `upsert: false`.

## Critérios de aceitação

- [ ] Nenhum método de Service com controle de acesso declara `opts?`.
- [ ] Todo método público de Service tem `@Validate` (com `returns:` quando
      devolve dados), ou um comentário dizendo por que não.
- [ ] `report.service.ts` afirma a permissão por registro.
- [ ] `assertScopeExists` usa `CourseService`.
- [ ] Os Services incompletos declaram as operações ausentes como `never`.
