---
type: adr
status: accepted
tags: [api, rest, auth]
created: 2026-11-03
decided: 2026-09-02
creator: claude
---

# REST API exige chave de API por padrão

Toda rota da REST API exige uma chave de API (CLI ou bot) no cabeçalho
`Authorization: Bearer`, a menos que a declaração diga `isPublic: true`.
Esquecer a flag falha fechado: a rota responde 401.

## Contexto

O documento OpenAPI declara `security: [{ BearerAuth: [] }]` no topo
(`src/api/registry/openapi-document.ts:61`), e `route.view` lança `NotAllowed`
(401) quando `locals.actor` está vazio (`src/api/registry/route.ts:216`). A
flag `isPublic` aparece no commit `26d8181` (2026-09-02); o motivo do padrão
fechado está em `src/api/README.md`.

## Decisão

- O padrão é exigir chave. `isPublic: true` faz duas coisas: emite
  `security: []` no documento e pula o 401.
- Só duas rotas são públicas: `GET /api/health` (um probe ainda não tem chave)
  e `POST /api/auth/login` (que é como se obtém uma). `POST /api/auth/logout`
  não é pública: precisa de uma sessão para encerrar.

## Consequências

- Uma rota nova sem a flag fica protegida e aparece como protegida no OpenAPI.
- Tornar uma rota pública é uma mudança visível no diff de `src/api/`.
