---
type: handoff
status: to-do
tags: [urls, rotas, paginas, tipos]
relatedTo: [0022-rotas-tipadas-pelo-registro-urls]
---

# Handoff: rotas tipadas, etapa do `<Link>`

## Onde estamos

Todas as páginas estão no registro `urls` (`src/urls/routes.ts`). Leia o ADR
0022 (`dev/adr/0022-rotas-tipadas-pelo-registro-urls.md`) e a seção
"Building links" de `src/urls/README.md`.

- O curso e os exames ficam em `urls.course(ref)`, que devolve `CourseUrls`
  (`exam(slug)` devolve `ExamUrls`). `loadCourse` devolve `links` e `ref`.
- Componentes `.astro` recebem `course: CourseUrls`. Ilhas Solid recebem
  `courseRef: CourseRef` e chamam `urls.course()` elas mesmas.
- `withAnchor(href, id)` e `withSearch(href, search)` juntam âncora e query
  sem perder o `Href`.
- `test/url-registry.spec.ts` rejeita, fora de `src/urls/` e `src/api/`, uma
  interpolação seguida de um segmento de página do curso (`${x}/roster`).

## O que falta

1. O componente `<Link href: Href>`, em `.astro` e em Solid.
2. As saídas `external(url)` (links externos, `mailto:`) e `anchor(id)` (`#id`
   na mesma página). Hoje `NavLink.href` em `src/utils/course-nav.ts` aceita
   `` `#${string}` `` para as âncoras; isso passa para `anchor(id)`.
3. O plugin GritQL do Biome que proíbe `<a href>` fora do `Link`, ligado
   quando nenhum `<a>` sobrar fora dele.

## Pendências menores

- `ExamAttempt.tsx` e `ExamResults.tsx` recebem o curso duas vezes: os
  segmentos `discipline`/`course` (para as actions) e `courseRef` (para os
  links). `GradesTable.astro` separa `course.index()` para obter os
  segmentos de `ReleaseGradeColumn`. Uma função em `src/urls/` que vá de
  `CourseRef` para os segmentos resolve os três.
- `courseHref(ref)` sobrou só nos specs e2e; pode virar
  `urls.course(ref).index()` e sair de `src/urls/index.ts`.

## Como trabalhar

- Outras sessões editam a árvore principal ao mesmo tempo. Trabalhe num
  worktree (`git worktree add ../codehood-typed-routes -b typed-routes main`)
  e faça merge fast-forward no fim. No worktree: `ln -s ../codehood/node_modules
  node_modules`, `pnpm run db:generate`, `pnpm run generate`. Não inclua o
  symlink no commit (`git add -A -- . ':!node_modules'`) e apague-o antes do
  `git worktree remove`.
- Depois de cada rebase sobre o `main`, rode o `url-registry.spec` de novo:
  páginas novas do `main` costumam trazer links escritos à mão.
