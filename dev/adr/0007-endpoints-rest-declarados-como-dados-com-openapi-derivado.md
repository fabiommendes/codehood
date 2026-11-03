---
type: adr
status: accepted
tags: [api, rest, openapi, zod]
created: 2026-11-03
decided: 2026-09-19
creator: claude
---

# Endpoints REST declarados como dados, com OpenAPI derivado

Cada endpoint REST é declarado uma vez, como dado, em `src/api/index.ts`.
Dessa declaração saem a validação, a rota do Astro e o documento OpenAPI, que
assim não diverge do handler. `CRUD()` transforma um Service (ADR 0004) em até
seis rotas.

## Contexto

O CLI e os grading bots consomem a API pelo documento OpenAPI (o CLI gera seu
cliente a partir dele). Documentação escrita à parte diverge do handler. O
commit `80ca002` (2026-09-19) passou a gerar as rotas CRUD a partir do
registro de Services.

## Decisão

- Endpoints são declarados em `src/api/index.ts` (mais `auth.ts` e
  `health.ts`). `CRUD(path, opts)` para um recurso sobre um Service;
  `GET`/`POST`/`PUT`/`PATCH`/`DELETE` para um endpoint avulso.
- A geração usa [`@asteasolutions/zod-to-openapi`][lib]. O documento é servido
  em `/openapi.json` e navegável como Swagger UI em `/api/docs`.
- O documento é montado do registro vivo, sob demanda (`buildOpenApiDocument()`
  em `src/api/registry/openapi-document.ts`). Não há artefato gerado para
  esquecer de regenerar; `test/openapi.spec.ts` verifica que `/openapi.json` é
  igual a `buildOpenApiDocument()`.
- A exceção é `src/api/registry/route-patterns.json`: o Astro precisa das rotas
  em `astro:config:setup`, antes que os módulos de rota possam ser importados,
  então os padrões vão para o disco (`pnpm run route-patterns`, chamado por
  `pnpm run generate` antes de `dev` e `build`).
- `CRUD()` gera:

  | Método   | Caminho    | Chamada no Service                        |
  | :------- | :--------- | :---------------------------------------- |
  | `POST`   | coleção    | `create`                                  |
  | `GET`    | coleção    | `findMany`                                |
  | `PUT`    | coleção    | `upsert` (pela chave natural no corpo)    |
  | `GET`    | item       | `findOne`                                 |
  | `PATCH`  | item       | `update`                                  |
  | `DELETE` | item       | `delete`                                  |

  O caminho do item é o da coleção mais `keySegment` (padrão `/[id]`). Passar
  `null` no schema de uma operação a remove; `skipFindOne`, `skipDelete` e
  `upsert: false` removem as que não têm schema próprio.
- Um erro lançado em qualquer etapa (autenticação, entrada, handler, saída)
  vira uma resposta JSON com o status do erro, por `responseFromException`
  (`src/core/error-server.ts`).

[lib]: https://github.com/asteasolutions/zod-to-openapi

## Consequências

- Um endpoint novo aparece na documentação ao ser declarado.
- Um endpoint novo que não está em `route-patterns.json` não é roteado: é
  preciso reiniciar o dev server, porque o hot reload não regenera o arquivo.
- Uma rota em `src/pages/api/` escrita à mão fica fora do OpenAPI. Hoje há uma:
  `src/pages/api/report/[publicId]/attachment/[filename].ts`.
