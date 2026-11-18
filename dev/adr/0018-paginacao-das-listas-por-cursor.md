---
type: adr
status: accepted
tags: [api, rest, paginas, performance, paginacao]
created: 2026-11-17
creator: claude
---

# Paginação das listas por cursor

Listas da API e das páginas que crescem com o banco são paginadas por cursor,
montado pelo service. Este documento diz como e como paginar uma lista nova.

## Contrato da API

Toda rota `GET` de lista responde `{ items, next, prev }`. `items` sai na
ordem padrão da tabela; `next`/`prev` são cursores opacos ou `null`. Rotas
paginadas aceitam `limit` (1 a 500, padrão 100), `after` (um `next`) ou
`before` (um `prev`), nunca os dois; cursor inválido ou os dois juntos é 400
(`src/core/schemas/page.ts`). Rota ainda não paginada devolve tudo com
`next` e `prev` nulos. Cliente sempre segue `next` até `null`. O envelope é
objeto para poder crescer sem quebrar o formato.

## Decisão

- **Ordem padrão `id` crescente** nas tabelas de id numérico. O cursor é o
  `id` do último item mascarado por uma função afim módulo 2⁶⁴ em base36
  (`src/utils/cursor.ts`): a máscara só evita expor a contagem de linhas de
  graça.
- **Chave pública como cursor.** `User` ordena e pagina por `username`;
  `Discipline` e `Edition` pelo `slug` (edições em ordem decrescente).
- **Sem `total` no envelope.** Custaria um `COUNT` por chamada. O service tem
  `count(filter)` à parte, que a página chama quando mostra o total.
- **O service monta a página.** A entidade não carrega `id`, então só o
  service conhece o cursor: `findPage(filter & { limit?, after?, before? })`
  devolve `{ items, next, prev }`, com `seekOf` e `cutPage` para os dois
  sentidos. `findMany` continua devolvendo array para usos internos. A REST só
  embrulha (`findManyHandler`).
- **Links das páginas** com `pageLinks` e `cursorParams`
  (`src/utils/page-links.ts`), que preservam os outros parâmetros da URL e
  entregam `prevHref`/`nextHref` a `PaginatedTable` ou `CursorPagination`.
- **A página lê com `readPage`** (`src/utils/list-page.ts`): 50 linhas, ou
  `?limit=` (1 a 500). Cursor ilegível ou que leva a página vazia mostra a
  primeira, porque a página vazia não tem link de saída. Os links partem de
  `listUrl(Astro.url)`, que tira o `_action` de um POST.
- **Formulário de página paginada posta para `actionHref(action, search)`**,
  que mantém `limit` e cursor: o resultado da action volta na mesma página e o
  diálogo de uma linha que falhou reabre nela.
- **Ordem variável usa cursor composto.** O service recebe
  `sort: { field, direction }`; o cursor é o par (valor da coluna, id), com
  `col > v OR (col = v AND id > último)` e `ORDER BY col, id`, para valores
  repetidos não pularem nem repetirem linhas. `encodeKeyCursor`,
  `decodeKeyCursor`, `pairWhere` e `scanDirection` servem a qualquer service.
  O cursor carrega a ordem; usado em outra ordem é 400. Enum no Prisma só
  compara por igualdade, então a ordem por enum lista os nomes além do cursor
  (`in`). `sort` não é parâmetro da REST.
- **Filtros e ordem ficam na URL** e vão ao service. Mudar filtro ou ordem
  volta à primeira página. Opções de filtro vêm de leitura estreita do service
  (`question.tags`), não da página carregada.

## Como paginar uma lista

- Service: `findPage` e `count` com o mesmo `where`. Modelos:
  `report.service.ts` (id), `question.service.ts` (composto com `sort`),
  `user.service.ts` (chave pública).
- Página: `readPage`, `listUrl`, `actionHref`, `pageLinks`. Modelos:
  `src/pages/admin/users.astro`,
  `src/pages/[discipline]/[course]/questions/index.astro`.
- Testes: `test/admin-list-pages.spec.ts`, `test/list-pagination.spec.ts`,
  `test/question-pages.spec.ts`. Operação de leitura nova que não se chame
  `findPage` ou `count` entra em READS de
  `test/conditional-write-sweep.spec.ts`.
- Rota REST que passa a paginar muda o OpenAPI: `pnpm run openapi:cli`.
- Rode `pnpm run test:perf` depois de mexer em consulta.

## Armadilhas

- `in: []` dentro de um `OR` do Prisma vira `1=0 OR …`, e o SQLite varre a
  tabela em vez de usar o índice dos outros ramos. Deixe o ramo vazio de fora.
- `_count` de relação no `select`/`include` faz `GROUP BY` da tabela filha
  inteira, mesmo em `findUnique`. Conte à parte, com `where` nos ids lidos.
- Filtros de relação como `feedbacks: { none: {} }` varrem a tabela filha.
  Parta do pai em SQL crua (`feedbackIdsOfCourse`, `response.settleExpired`).
- Toda leitura de tentativas exclui a simulação do professor (ADR 0017,
  `src/db/preview-filter.ts`).
- Teste não supõe banco pequeno ("cabe em uma página") nem casa texto parcial
  de usuário; compare a célula inteira.
- O xterm não desenha fora da viewport: teste que lê a saída de um terminal
  fora da tela só passa se ela chegar antes da rolagem.

## Consequências

- Mudar o envelope quebrou a CLI instalada; snapshot do OpenAPI, cliente
  gerado e CLI mudaram juntos. Mudanças futuras no envelope entram como campo
  opcional.
