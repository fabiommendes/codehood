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
   cursor é o próprio `username`.
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

4. `/admin/courses`: lista pura, a mais simples.
5. `/courses` (`courses/index.astro:21`): grade de cartões.
6. `/admin/users`: os totais por papel já vêm de `user.countByRole`; falta a
   tabela.
7. `/admin`: os contadores já usam `countByRole` e `course.count`; os
   convites ainda são filtrados em JS.
8. `/admin/disciplines` e `/admin/editions`: a contagem de cursos já vem de
   `course.countBy`; falta a tabela.
9. `/admin/reports` e `[course]/reports`: o service descarta linhas por
   permissão depois da consulta, então uma página pode vir curta.

**Dentro de um curso.**

10. `/questions`: `QuestionsTable` filtra, ordena e monta o menu de tags no
    cliente sobre o banco inteiro. Os filtros precisam ir para a URL (o
    service já aceita `statuses`, `types`, `tags`).
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
