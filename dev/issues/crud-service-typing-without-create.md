---
type: issue
status: backlog
tags: [api, typing, crud]
relatedTo: [roll-call]
---

# `CRUD` exige `create` e `upsert` do service mesmo sem as rotas

`CrudRouteOptions.service` em `src/api/registry/crud.ts` exige `Create` e
`Upsert` com a forma `CreateT & CreateExtra`, mesmo quando a rota é
retirada (`create: null`, `upsert: false`). O `RollCallService.create`
recebe `{ event, actsAsInvite }`, não o escopo do curso, então
`rollCallApi` em `src/api/index.ts` só compila com `db.rollCall as never`.
Esse cast desliga a checagem de tipos do service inteiro naquela rota.

Há também um descompasso de branding: a chave `rollCallPK` sai com
`RollCallId` e o service recebe `number`, ou o contrário.

Tentativas que não bastaram: `Partial<Create & Upsert>` (a propriedade
existe com tipo incompatível) e `create: null as ZodType<never> | null`.

Correção provável: tornar o tipo de `service` condicional ao `create` e ao
`upsert` serem retirados, por exemplo com um parâmetro genérico booleano
ou overloads de `CRUD`.
