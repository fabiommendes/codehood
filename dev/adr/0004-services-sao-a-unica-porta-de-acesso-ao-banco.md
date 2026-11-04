---
type: adr
status: accepted
tags: [db, services]
created: 2026-11-03
decided: 2026-08-26
creator: claude
---

# Services são a única porta de acesso ao banco

Todo acesso ao banco passa por uma classe Service por modelo, em
`src/db/services/`, com a mesma interface CRUD (`create`, `findOne`,
`findMany`, `update`, `upsert`, `delete`). Actions, REST API, RPC e comandos de
gerenciamento são camadas finas sobre os Services e só tocam o Prisma para
abrir uma transação que atravessa vários Services.

## Contexto

O servidor tem quatro portas de entrada (Astro Actions, REST API, RPC e
comandos de gerenciamento) sobre o mesmo banco. Regras de negócio e checagens
de acesso espalhadas por essas portas divergem entre si. O commit `1c13f27`
(2026-08-26) refatorou os services para implementar as interfaces de
`src/db/base-service.ts`, e o `80ca002` (2026-09-19) passou a gerar as rotas
CRUD da REST API a partir dessa interface (ADR 0007).

## Decisão

- Uma classe Service por modelo, em `src/db/services/<modelo>.service.ts`. Ela
  guarda as regras de negócio e as checagens de acesso do modelo (ADR 0005) e
  não deixa tipos do Prisma saírem dela. Os tipos públicos são os schemas de
  `src/core/schemas/`.
- A interface é uniforme, com os tipos em `src/db/base-service.ts`
  (`Create`, `FindOne`, `FindMany`, `Update`, `Upsert`, `Delete`, `Crud`):

  | Operação | Assinatura                    |
  | :------- | :---------------------------- |
  | Create   | `create(input, opts)`         |
  | Read     | `findOne(filterPk, opts)`     |
  | List     | `findMany(filter, opts)`      |
  | Update   | `update(filterPk, data, opts)` |
  | Upsert   | `upsert(input, opts)`         |
  | Delete   | `delete(filterPk, opts)`      |

- Implemente o conjunto inteiro, mesmo quando a funcionalidade usa só parte.
  Uma operação que não faz sentido para o modelo é declarada com tipo `never`
  (o parâmetro do `Crud`, ou `upsert: false`), para que a ausência apareça no
  tipo e não como um "Method not implemented" em tempo de execução.
- Cada Service é `defineService<XT>()((client) => ({ create: op({...}), ... }))`
  (`src/db/define-service.ts`). Cada operação é escrita uma vez, contra uma
  transação (`run(tx, ...args, opts)`), e o builder deriva o método público que
  abre a transação ou reusa `opts.tx`. Só as operações fornecidas existem no
  tipo do resultado, então chamar uma operação ausente é erro de compilação no
  chamador. Isso substitui o `never` por operação; o `upsert: false` do `CrudT`
  continua valendo para tipar o CRUD (`UpsertIn`).
- Soft delete reusa `delete()`: para quem chama, não há diferença em relação a
  um delete físico. Hoje só `Blob` tem `deletedAt`; `Question` arquiva com
  `status: "ARCHIVED"`.
- Código que não lê nem escreve o banco fica fora de `src/db/`: regras de
  domínio em `src/services/`, utilitários em `src/utils/`.

Convenções de escrita (ordem dos métodos, erros esperados, passo a passo para
criar um Service) estão no RFC `dev/rfc/como-criar-e-escrever-um-service.md`.

## Consequências

- Uma regra de acesso ou de negócio é escrita uma vez e vale para todas as
  portas de entrada.
- A REST API ganha CRUD quase de graça (ADR 0007), porque todo Service tem a
  mesma forma.
- Modelos que não são CRUD (sessão, feed de calendário, blob) ficam
  desajeitados: declaram vários métodos `never` e expõem a API real em métodos
  extras.
- Não há mais classe base nem métodos `xxxTx`: um Service é um valor criado por
  `defineService`, e a ausência de uma operação é checada pelo compilador, não
  por um "Method not implemented" em tempo de execução.

## Notas

- 2026-11-04: os 26 Services migraram de `CrudBase` e `@Validate` para
  `defineService`. `CrudBase` foi removida de `src/db/base-service.ts`, que
  mantém só os tipos CRUD, `ServiceOpts` e o helper `upsert`.
