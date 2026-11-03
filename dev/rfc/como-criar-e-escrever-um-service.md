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

Prática recomendada para criar uma classe Service nova e escrever seus
métodos: ordem dos métodos, erros esperados e o passo a passo do modelo Prisma
até o seed. As regras que um Service precisa cumprir estão nos ADRs 0004
(interface CRUD), 0005 (actor obrigatório) e 0006 (validação).

## Ordem dos métodos

Ordene os métodos como a interface CRUD os lista: `create`, `findOne`,
`findMany`, `update`, `upsert`, `delete`. Os demais métodos públicos vêm
depois. Os utilitários privados ficam no fim da classe, depois de um
separador que vai até a coluna 80:

```ts
	// Private utilities -------------------------------------------------------
```

Os tipos exatos estão em `src/db/base-service.ts`.

## Erros esperados

`create()` verifica se a entidade já existe e lança o erro adequado, em vez de
deixar a violação de unicidade virar um 500. O helper `invalidIfExists`, em
`src/db/utils.ts`, faz essa verificação.

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
6. Crie a classe com os métodos CRUD vazios. No modo interativo, o humano pode
   preencher helpers e regras de negócio aqui. Fora dele, continue.
7. Decida se o Service aparece na REST API. Se sim, declare os endpoints em
   `src/api/index.ts`, com escopo (em geral, um curso) ou na raiz. No modo
   interativo, essa decisão pode precisar da confirmação do humano.
8. Se houver REST API, acrescente exemplos em `test/bruno/` e reinicie o dev
   server: as rotas são registradas na inicialização, não no hot reload.
9. Escreva as fixtures de teste em `src/fixtures/<service-name>.factory.ts`,
   com fishery. Reaproveite as factories das entidades relacionadas.
10. Siga a skill `tdd`: um agente implementer escreve os métodos na ordem
    (create, findOne, findMany, update, upsert, delete), e um agente tester
    escreve testes para as regras de acesso e o tratamento de erros.
11. Semeie exemplos em `src/db/bootstrap.ts`.
12. Garanta testes para a lógica de negócio não trivial e para as regras de
    autorização.
13. Revise o trabalho de cada sub-agente.
