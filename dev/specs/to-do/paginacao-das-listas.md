---
type: spec
status: doing
tags: [api, performance, pagination]
relatedTo: [consultas-que-crescem-com-o-banco]
created: 2026-11-14
creator: claude
---

# Paginação das listas

## Problema

As listas da API e das páginas carregam a tabela inteira. `GET /api/course`,
`GET /api/user` e as páginas de admin crescem com o banco (ver
`dev/issues/consultas-que-crescem-com-o-banco.md`).

## Contrato da API

Toda rota `GET` de lista (19 hoje) responde com um envelope:

```json
{ "items": [...], "next": "3w5e11264sgsg", "prev": null }
```

- `items`: a página, na ordem padrão da tabela, qualquer que seja o sentido
  em que se chegou a ela.
- `next`: cursor da página seguinte, ou `null` na última.
- `prev`: cursor da página anterior, ou `null` na primeira.
- O envelope é um objeto para poder crescer (`related`, `total`) sem quebrar
  o formato outra vez.

Rotas paginadas aceitam, além do filtro:

- `limit`: tamanho da página, de 1 a 500. Padrão 100.
- `after`: o `next` de uma resposta anterior.
- `before`: o `prev` de uma resposta anterior. Não vale junto com `after`.

Um cursor inválido, ou os dois juntos, é `400`.

Uma rota ainda não paginada devolve tudo com `next` e `prev` nulos e não
declara `limit`, `after` nem `before`. Quem consome deve sempre seguir `next` até `null`.

## Decisões

1. **Cursor, não offset.** Estável quando entram linhas e barato em qualquer
   página.
2. **Ordem padrão: `id` crescente** nas tabelas com id numérico. O cursor é o
   `id` do último item mascarado por uma função afim módulo 2⁶⁴ em base36
   (`src/utils/cursor.ts`). Vazar um id não é crítico; a máscara só evita
   expor a contagem de linhas de graça.
3. **`User` ordena por `username`**, que é a chave primária e já é pública. O
   cursor é o próprio `username`. `Discipline` e `Edition` fazem o mesmo com
   o `slug`; as edições saem em ordem decrescente, a mais recente primeiro.
4. **Sem `total` no envelope.** Custa um `COUNT` por chamada e o cursor não
   precisa dele. O total fica numa operação à parte do service,
   `count(filter)`, que a página chama junto quando quer mostrar o número de
   páginas. Se a API precisar, entra como campo opcional do envelope.
5. **O service monta a página.** A entidade não carrega `id`, então só o
   service sabe o cursor. Um service paginado ganha
   `findPage(filter & { limit?, after?, before? }) → { items, next, prev }`.
   `seekOf` e `cutPage` (`src/utils/cursor.ts`) cuidam dos dois sentidos. `findMany`
   continua devolvendo array para os usos internos e some de cada service
   quando o último uso sem limite sair.
8. **As páginas montam os links com `pageLinks` e `cursorParams`**
   (`src/utils/page-links.ts`), que entregam `prevHref` e `nextHref` ao
   `PaginatedTable` e preservam os outros parâmetros da URL.
9. **A página lê com `readPage`** (`src/utils/list-page.ts`): 50 linhas, ou o
   `?limit=` da URL (1 a 500), que serve para ver a paginação com poucos
   dados. Um cursor ilegível ou que leva a uma página vazia mostra a primeira
   página, porque a página vazia não tem link de saída. Os links partem de
   `listUrl(Astro.url)`, que tira o `_action` deixado por um POST.
10. **Formulário de página paginada posta para `actionHref(action, search)`**,
    que mantém `limit` e o cursor: o resultado da action volta na mesma
    página da lista, e o diálogo de uma linha que falhou reabre nela. Uma
    linha criada pode cair em outra página; a mensagem de sucesso basta.
11. **Ordem variável: cursor composto.** Um service que ordena por mais de
    uma coluna recebe `sort: { field, direction }` no `findPage`
    (`question`: `slug`, o padrão, `title`, `status`, `type`, `updated`). O
    cursor é o par (valor da coluna, id da linha), para que valores
    repetidos não pulem nem repitam linhas: a página seguinte é
    `col > v OR (col = v AND id > último)` com `ORDER BY col, id`, espelhado
    na ordem decrescente e no `before`. `encodeKeyCursor`, `decodeKeyCursor`,
    `pairWhere` e `scanDirection` (`src/utils/cursor.ts`) servem a qualquer
    service. O cursor segue opaco e carrega a ordem (`status:asc`): usado
    em outra ordem é `400`, como um cursor inválido. O Prisma só compara
    enum por igualdade, então `status` e `type` listam os nomes além do
    cursor (`in`). O título ordena pela relação `latest.title`, sem SQL
    cru; texto compara byte a byte e enum pelo nome guardado. Uma questão
    sem `latest` (estado que só existe dentro da criação) não aparece na
    página nem na contagem. Pela REST a lista sai na ordem padrão: `sort`
    não é parâmetro da API.
12. **Filtros e ordem da página ficam na URL** e vão ao service. Mudar
    filtro ou ordem leva à primeira página (o cursor sai da URL). O que o
    filtro oferece (as tags do banco de questões) vem de uma leitura
    estreita do service (`question.tags`), não da página carregada.
6. **A camada REST só embrulha.** `findManyHandler` chama `findPage` quando o
   service tem, e senão devolve `{ items: await findMany(), next: null }`.
7. **Quebra a CLI instalada.** Aceito: o snapshot do OpenAPI, o cliente gerado
   e a CLI mudam junto.

## Plano

1. Núcleo: cursor, schemas `pageParams` e `pageOf`, envelope nas 19 rotas,
   `findPage` e `count` em `course` e `user`, testes, snapshot do OpenAPI.
2. CLI: seguir `next` em toda leitura de lista.
3. Páginas, uma por vez e por prioridade, com o componente de tabela
   paginada: `/admin` (usuários, cursos, disciplinas, edições), questões do
   professor, e as demais listas que crescem sem limite.
4. `pnpm run test:perf` inteiro para fechar a issue.

## Fila das páginas

Levantamento de 2026-11-14 (por leitura do código, não conferido rota a
rota). A ordem é a de prioridade.

**Não é paginação: falta filtro.** Para um admin, `course.findMany({})`
carrega todos os cursos da instância.

1. `src/layouts/AppLayout.astro:36`: a barra lateral, em toda página.
2. `/home`: `load-student-home.ts:29` e `load-instructor-home.ts:37`, que
   ainda carregam provas, respostas e feedbacks de cada curso.
3. `/calendar` (`calendar.astro:34`): todos os cursos, todos os eventos sem
   intervalo de datas e uma consulta de provas por curso.

Feito em 2026-11-14 com os filtros `member` e `instructor`. Ficou de fora o
intervalo de datas dos eventos do `/calendar`.

**Admin: tabela paginada, e contagens no lugar de listas.**

4. [x] `/admin/courses`: lista pura, a mais simples.
5. [x] `/courses` (`courses/index.astro`): grade de cartões, com
   `CursorPagination` abaixo.
6. [x] `/admin/users`: tabela por `username`; o total é a soma de
   `user.countByRole`.
7. [x] `/admin`: disciplinas e edições por `count` (edições abertas com
   `edition.count({ active: true })`) e amostra de três slugs com
   `discipline.findPage({ limit: 3 })`. Os convites ainda são filtrados em
   JS: `inviteFilter` não tem `invitedRole`, e incluí-lo muda a API.
8. [x] `/admin/disciplines` e `/admin/editions`: `findPage` e `count` nos
   dois services, o que também paginou `GET /api/discipline` e
   `GET /api/edition`.

Itens 4 a 8 feitos em 2026-11-15. Testes em `test/admin-list-pages.spec.ts`
e `test/list-pagination.spec.ts`.

9. [x] `/admin/reports` e `[course]/reports`: `report.findPage` e
   `report.count`, por `id` crescente (a fila sai da mais antiga para a
   mais nova, como antes), com `CursorPagination` abaixo dos cartões. O
   descarte por permissão depois da consulta era redundante: `visibleWhere`
   já expressa a regra inteira de `report.read` (admin e SYSTEM leem tudo;
   os demais, os próprios relatos e os `CONTENT` dos cursos que lecionam),
   então o banco devolve só linhas visíveis e as páginas vêm cheias. O
   `findPage` ainda confere cada linha com `hasPerm` e lança `NotAllowed`
   se a consulta e a regra divergirem, como em `course.findPage`: falha em
   vez de vazar ou encurtar a página. `count` usa o mesmo `where`. Os
   filtros de status e tipo já ficavam na URL; os links deles mantêm
   `limit` e largam o cursor. A triagem é uma action chamada pela ilha, sem
   navegação, então fica na mesma página; um relato que deixa de casar com
   o filtro some da página carregada sem puxar o seguinte. Também paginou
   `GET /api/report`. Feito em 2026-11-16. Testes em
   `test/report-service.spec.ts` e `test/admin-list-pages.spec.ts`.

**Dentro de um curso.**

10. [x] `/questions`: `question.findPage` com `sort`, `count` e `tags`;
    filtros e ordenação na URL (`src/utils/question-list-query.ts`). A
    coluna de tags só filtra. Feito em 2026-11-15, o que também paginou a
    lista REST de questões. Testes em `test/question-pages.spec.ts` e
    `test/question-bank-page.spec.ts`.
11. `/roster` e `/attendance`: o CSV e os totais precisam do conjunto inteiro.
12. `/resources`: agrupado por tipo e por evento.
13. `/exams`: `ExamsTable` ordena no cliente.

**Consulta mais estreita, não tabela.** Correção, notas e revisões montam
tudo em memória a partir de todas as tentativas e feedbacks da prova
(`load-grading.ts`, `grades.astro`, `exams/[slug].astro`, `regrades.astro`).
`attempts/[username].astro` carrega todas as tentativas para achar uma.
`CourseHeader.astro:31` e `getting-started.astro:17` carregam uma lista para
testar se é vazia.

Peças de UI existentes: `src/components/ui/Table.tsx` e
`src/components/ui/table-sort.ts`, que guarda a ordenação na URL.

## Retomada (handoff de 2026-11-16)

Estado: itens 1 a 10 feitos e enviados ao remoto. `test:perf` inteiro (antes
do último rebase) deixou 3 de 249 rotas acima de 2×, todas abaixo de 7 ms;
ver o andamento em `dev/issues/consultas-que-crescem-com-o-banco.md`.

### O que falta, na ordem sugerida

1. **Medir antes de mexer.** Rodar `rtk pnpm run test:perf` de novo: os
   números são de antes do rebase sobre 20 commits do remoto. Guardar a saída
   inteira num arquivo (o relatório fica em `.perf/<hora>/report.md`, mas os
   nomes dos specs que falham só aparecem na saída do Playwright).
2. **`GET /<curso>/attendance` (3,8×, 1,5 → 5,7 ms) e `POST /admin` (2,4×,
   2,6 → 6,3 ms).** São as duas rotas que ainda descumprem o critério da
   issue. Não investigadas. Em `/admin`, os convites pessoais são carregados
   e filtrados em JS porque `inviteFilter` não tem `invitedRole`; incluí-lo
   muda a API. Em `/attendance`, achar a consulta que cresce com
   `test:perf test/<spec de attendance>` e a seção "Statements slow only on
   the full database".
3. **Item 11, `/roster` e `/attendance`.** O CSV e os totais precisam do
   conjunto inteiro. Caminho provável: a tabela pagina com `findPage`, os
   totais vêm de `count`/agregações no service e o CSV continua usando
   `findMany`. Decidir com o humano se vale: a lista é limitada pelo tamanho
   da turma, não do banco.
4. **Item 12, `/resources`.** Agrupado por tipo e por evento; paginar grupos
   não é óbvio. Mesma ressalva de tamanho.
5. **Item 13, `/exams`.** `ExamsTable` ordena no cliente. Segue o molde de
   `/questions` (cursor composto, `sort` na URL).
6. **`/calendar`:** os eventos ainda vêm sem intervalo de datas. Não é
   tabela: falta um filtro de datas no service de eventos. A rota REST de
   `calendar-event` já tem um parâmetro de filtro chamado `limit`, que vai
   colidir com o `limit` da paginação quando ela for paginada.
7. **Consultas mais estreitas** (último parágrafo da fila): correção, notas,
   revisões, `attempts/[username].astro`, `CourseHeader.astro`,
   `getting-started.astro`.

Os itens 3 a 5 seguem o tamanho de um curso, não o do banco. Se a medição do
passo 1 não os acusar, a issue pode ser fechada sem eles e este spec vai para
`to-review/` com a fila restante registrada como trabalho futuro.

### Como fazer cada página

O molde está pronto; copiar, não reinventar.

- Service: `findPage` e `count` com o mesmo `where`; `findMany` continua
  devolvendo array. Exemplos: `report.service.ts` (cursor simples por id),
  `question.service.ts` (cursor composto com `sort`), `user.service.ts`
  (cursor é a chave pública).
- Página: `readPage`, `listUrl`, `actionHref` (`src/utils/list-page.ts`) e
  `pageLinks` (`src/utils/page-links.ts`); `PaginatedTable` ou
  `CursorPagination`. Exemplos: `src/pages/admin/users.astro` e
  `src/pages/[discipline]/[course]/questions/index.astro`.
- Testes: `test/admin-list-pages.spec.ts`, `test/question-pages.spec.ts`,
  `test/question-bank-page.spec.ts`. Uma operação de leitura nova que não se
  chame `findPage` ou `count` entra no conjunto READS de
  `test/conditional-write-sweep.spec.ts`.
- Uma rota REST que passa a paginar muda o OpenAPI: `pnpm run openapi:cli`.
- Um subagente por item, em sequência, com as decisões já tomadas no
  briefing; revisar o diff, rodar lint e os specs tocados, e só então commitar.

### Armadilhas vistas

- **Testes que supõem banco pequeno** falham só no banco cheio: não afirmar
  "cabe em uma página" nem percorrer a lista inteira de usuários de 2 em 2.
- **Seletores por texto parcial** (`hasText: "@alan"`) casam com usuários de
  fábrica de nome parecido; comparar a célula inteira.
- **`feedbacks: { none: {} }` e filtros de relação do Prisma** agregam ou
  varrem a tabela inteira no SQLite. Partir do pai em SQL crua, como
  `feedbackIdsOfCourse` e `response.settleExpired`.
- **Tudo que lê tentativas** precisa ignorar a simulação do professor
  (`realAttempt`, `realAttemptSql` em `src/db/preview-filter.ts`).
- **Instáveis sob carga, passam sozinhos:** `island-conditional-write`
  (issue aberta), `grading-code-answer.spec.ts:189`,
  `exam-answer-edit-isolation.spec.ts:483`, `exam-delivery.spec.ts:247`.
- **O checkout vizinho `../mdq`** precisa acompanhar o remoto dele e ser
  reconstruído (`pnpm run build` em `mdq-js`) quando o typecheck reclamar de
  `mdq/solid`.

### Achados sem dono

- `report.toReport` faz uma consulta de anexos por linha.
- `profile.astro` e `blob.service.ts` chamam `report.findMany` sem limite.
- `sort` não é parâmetro da lista REST de questões (sempre por slug).
- Listar os feedbacks de um curso grande custa ~100 ms fora do SQLite, pelos
  `include` de cada linha.
- `GET /openapi.json` gasta ~460 ms de CPU síncrona por chamada, sem cache.
