---
type: issue
status: backlog
tags: [db, services, auth]
relatedTo: [0004-services-sao-a-unica-porta-de-acesso-ao-banco, 0005-actor-obrigatorio-em-toda-chamada-de-service, 0006-validacao-de-entrada-e-saida-nos-services]
kind: defect
priority: medium
created: 2026-11-03
creator: claude
---

# Services fogem das regras dos ADRs 0004 a 0006

Ao transformar `src/db/services/README.md` nos ADRs 0004 a 0006, a comparação
com o código achou métodos que não seguem as regras. A migração para
`defineService` (2026-11-04) fechou o `opts?` opcional (o builder exige
`ServiceOpts`), o `@Validate` ausente (toda operação passa por `op()`) e as
interfaces incompletas (operação ausente não existe no tipo). Sobram os
pontos abaixo.

## Problema

**`findMany` que filtra em silêncio (ADR 0005):**
`report.service.ts`, no `findMany`, usa `hasPerm` para descartar registros
em vez de `ensurePerm` para afirmar.

**Prisma fora de um Service (ADR 0004):**
`src/api/registry/crud.ts` (`assertScopeExists`) consulta `prisma.course`
direto, sem actor.

**`returns:` ausente (ADR 0006):** algumas operações que devolvem dados
foram migradas sem `returns:` porque o `@Validate` original já não tinha.
Auditar os `op({ ... })` sem `returns` em `src/db/services/` e preencher os
que devolvem entidades.

## Critérios de aceitação

- [ ] `report.service.ts` afirma a permissão por registro.
- [ ] `assertScopeExists` usa `CourseService`.
- [ ] Toda operação que devolve dados tem `returns:`, ou um comentário
      dizendo por que não.
