---
type: issue
status: backlog
tags: [db, services]
kind: task
priority: low
created: 2026-11-03
creator: claude
---

# Convenções de escrita dos Services não seguidas

O RFC `dev/rfc/como-criar-e-escrever-um-service.md` pede uma ordem de métodos e um separador, e que
`create()` use `invalidIfExists`. O código diverge.

## Problema

- Ordem fora do padrão em api-key, course, exam, calendar-event, passphrase,
  session e user (métodos extras ou privados no meio do CRUD).
- Só 6 dos 26 arquivos têm `// Private utilities ---`; em feedback, response e
  submission ele fica fora da classe; em roll-call passa da coluna 80.
- 17 Services não usam `invalidIfExists` no `create()` (user, question,
  resource, time-slot, calendar-event, repository, invite, entre outros).
  Verificar quais deixam a violação de unicidade virar 500.

## Critérios de aceitação

- [ ] Nenhum `create()` devolve 500 para uma chave duplicada.
- [ ] Ordem e separador corrigidos, ou a regra removida do RFC.
