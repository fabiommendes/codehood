---
type: issue
status: backlog
tags: [test, api]
relatedTo: [0007-endpoints-rest-declarados-como-dados-com-openapi-derivado]
kind: defect
priority: low
created: 2026-11-04
creator: claude
---

# `openapi.spec.ts` depende da ordem dos testes

`test/openapi.spec.ts` ("GET /openapi.json ... matches the registrations")
passa sozinho e falha na suíte inteira quando cai no mesmo worker que
`test/crud-registry-typing.spec.ts`. Este registra `/api/test-crud-no-create`
no registro global, então `buildOpenApiDocument()` no processo do teste tem
rotas que o servidor não tem.

## Critérios de aceitação

- [ ] `crud-registry-typing.spec.ts` não deixa rotas no registro global, ou o
      teste do OpenAPI compara só as rotas do servidor.
- [ ] A suíte inteira passa com `test/openapi.spec.ts` em qualquer ordem.
