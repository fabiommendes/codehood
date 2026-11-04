---
type: issue
status: backlog
tags: [test, schemas]
kind: defect
priority: low
created: 2026-11-04
creator: claude
---

# `schemas-browser-safe.spec.ts` falha com `TextEncoder is not defined`

`test/schemas-browser-safe.spec.ts` roda o barrel de schemas num
`vm.createContext({})` vazio e falha com `ReferenceError: TextEncoder is not
defined` (Node 26.7). Falha igual na `main` em 2026-11-04.

## Critérios de aceitação

- [ ] Decidir se o contexto do teste deve expor as globais que todo browser
      tem (`TextEncoder`, `TextDecoder`) ou se o barrel não deve usá-las no
      carregamento.
- [ ] O teste passa.
