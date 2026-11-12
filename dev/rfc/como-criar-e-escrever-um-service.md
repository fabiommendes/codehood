---
type: rfc
status: accepted
tags: [db, services, bcp]
relatedTo: [0004-services-sao-a-unica-porta-de-acesso-ao-banco, 0005-actor-obrigatorio-em-toda-chamada-de-service, 0006-validacao-de-entrada-e-saida-nos-services]
created: 2026-11-03
decided: 2026-11-03
creator: claude
---

# Como criar e escrever um Service

Prática recomendada para criar um Service novo e escrever seus
métodos: ordem dos métodos, erros esperados e o passo a passo do modelo Prisma
até o seed. As regras que um Service precisa cumprir estão nos ADRs 0004
(interface CRUD), 0005 (actor obrigatório) e 0006 (validação).

## Estrutura

Um Service é o resultado de `defineService` (`src/db/define-service.ts`). Cada
operação é um `op({ args, returns, run })` escrito contra a transação; o
builder deriva o método público `(...args, opts)`, que abre a transação ou
reusa `opts.tx`. Anote os parâmetros de `run`, ou o tipo dos argumentos vira
`any[]` (ADR 0006).

```ts
export const makeFooService = defineService<FooT>()((client) => ({
	findOne: op({
		args: [fooPK],
		returns: fooSchema.nullable(),
		run: async (tx: PrismaTx, pk: FooPK, opts: ServiceOptsWithoutTx) => {
			// ...
		},
	}),
}));
export const fooService = makeFooService();
```

Forneça só as operações que fazem sentido: as ausentes não existem no tipo.
Operações podem chamar umas às outras passando o mesmo `tx`.

Por padrão, a operação roda numa transação. Leituras declaram
`transaction: false` e rodam direto no client (ou no `opts.tx` de quem chama),
sem disputar a trava de transação do SQLite. Escritas mantêm o padrão.

## Ordem das operações

Ordene as operações como a interface CRUD as lista: `create`, `findOne`,
`findMany`, `update`, `upsert`, `delete`. As demais vêm depois. Os utilitários
privados ficam no fim do módulo, depois de um separador que vai até a coluna
80:

```ts
// Private utilities -------------------------------------------------------
```

Os tipos exatos estão em `src/db/base-service.ts`.

## Erros esperados

`create()` verifica se a entidade já existe e lança o erro adequado, em vez de
deixar a violação de unicidade virar um 500. O helper `invalidIfExists`, em
`src/db/utils.ts`, faz essa verificação.

## Escrita condicional

Todo `update`, `upsert` e `delete` de um modelo com `updatedAt` honra
`opts.expectedUpdatedAt` (ADR 0013), sempre pelos helpers de
`src/db/conditional-write.ts`. A escrita guardada roda no `tx` da própria
escrita (nunca no client), com um `where` único do modelo, e o helper grava o
`updatedAt`: não há valor para repassar.

```ts
// update: confere a versão e grava os campos com o próximo updatedAt
const row = await guardedUpdate(tx, "course", { id }, fields, opts, {
	include: courseInclude,
});

await guardedDelete(tx, "course", { id }, opts); // delete
await touch(tx, "exam", { id }, opts); // só filhos mudaram: bumpa a linha mãe
await writeCache(tx, "repository", { id }, { zipHash }); // cache: mantém a versão
```

- Mudou só filhos que o read model da linha mostra (tags, questões,
  repositórios)? Chame `touch` na linha mãe.
- Gravou um valor que o read model não devolve e que dá para recalcular (o
  `zipHash` do repositório)? Use `writeCache`: ela mantém o `updatedAt`. Um
  bump aí faria a próxima escrita condicional de quem não leu nada de novo
  falhar com 412.
- Um filho de outra tabela que o read model da mãe mostra (o arquivo de um
  recurso, uma presença de roll call) também bumpa a mãe, mesmo quando quem
  escreve é outro service: faça `touch` na mãe, mas só se ela ainda aponta para
  o filho. Uma escrita da própria mãe que já passou pelo helper não precisa de
  segundo bump (o `updatedAt` devolvido ficaria velho).
- No `upsert`, quando a linha não existe, use
  `checkExpectedUpdatedAt(null, opts.expectedUpdatedAt)`: um `Date` falha, e
  `null` ou ausente passa. Quando existe, `guardedUpdate` recusa o `null`.
- `Date` sobre linha inexistente é `PreconditionFailed` com `updatedAt: null`.
  Se o service procura a linha antes e daria `NotFound`, chame
  `checkExpectedUpdatedAt(null, opts.expectedUpdatedAt)` antes do `NotFound`.
  Sem `expectedUpdatedAt`, o `NotFound` continua.
- Precisa de outra checagem entre a versão e a escrita (um 409 que um chamador
  obsoleto não deve ver)? `checkVersion` só confere, sem gravar.
- Escritas derivadas em outras linhas (como recalcular eventos) também passam
  por `guardedUpdate`, para a versão antiga dessas linhas ficar obsoleta.
- Não repasse `opts` a outro service sobre outra linha: o
  `expectedUpdatedAt` é desta.
- Modelo sem `updatedAt` (ex.: `Edition`) chama `rejectExpectedUpdatedAt(opts)`
  no início de cada escrita: a condição é recusada, não ignorada.

`test/conditional-write-sweep.spec.ts` varre `src/db/` (services e arquivos
auxiliares) e falha quando uma escrita num modelo com `updatedAt` não passa
pelo helper (inclusive SQL cru com `UPDATE` ou `DELETE`, delegate tirado de
`tx` por desestruturação ou índice, e escrita aninhada numa relação; os limites
da varredura estão no topo do spec), ou quando o service dono do modelo não está em `HONORED` (com um
caso obsoleto e um com a versão certa por escrita). `PENDING` lista os que
ainda faltam e deve ficar vazia.

## REST API

A maioria dos Services tem REST API (ADR 0007). Quando tiver, acrescente
exemplos de requisição em `test/bruno/`.

## Passo a passo

1. Defina o modelo Prisma que o Service vai envolver.
2. Veja quais campos precisam de branding e atualize `src/db/branding.ts`.
3. Escreva os schemas em `src/core/schemas/`. Eles dizem que partes do banco
   ficam expostas a quem usa o Service.
4. No modo interativo, pare e peça ao humano que revise os schemas antes de
   seguir. Fora dele, continue.
5. Se a entidade entra no sistema de permissões, acrescente uma entrada em
   `src/auth/permissions/` e atualize as regras de acesso.
6. Crie o `defineService` com as operações CRUD necessárias. No modo interativo, o humano pode
   preencher helpers e regras de negócio aqui. Fora dele, continue.
7. Decida se o Service aparece na REST API. Se sim, declare os endpoints em
   `src/api/index.ts`, com escopo (em geral, um curso) ou na raiz. No modo
   interativo, essa decisão pode precisar da confirmação do humano.
8. Se houver REST API, acrescente exemplos em `test/bruno/` e reinicie o dev
   server: as rotas são registradas na inicialização, não no hot reload.
9. Escreva as fixtures de teste em `src/fixtures/<service-name>.factory.ts`,
   com fishery. Reaproveite as factories das entidades relacionadas.
10. Siga a skill `tdd`: um agente implementer escreve as operações na ordem
    (create, findOne, findMany, update, upsert, delete), e um agente tester
    escreve testes para as regras de acesso e o tratamento de erros.
11. Semeie exemplos em `src/db/bootstrap.ts`.
12. Garanta testes para a lógica de negócio não trivial e para as regras de
    autorização.
13. Revise o trabalho de cada sub-agente.
