---
type: handoff
status: to-do
tags: [urls, rotas, paginas, tipos]
relatedTo: [0022-rotas-tipadas-pelo-registro-urls]
---

# Handoff: rotas tipadas, etapa do curso

## Onde estamos

O registro de rotas tipadas está no `main` (`90ed28c7`, `f673834a`,
`408e9a28`). Leia antes o ADR 0022
(`dev/adr/0022-rotas-tipadas-pelo-registro-urls.md`) e a seção "Building
links" de `src/urls/README.md`.

- `urls` (`src/urls/routes.ts`) tem uma função por rota, declarada com
  `route(pattern, query?)`. Os nomes dos parâmetros saem do padrão
  (`urls.invite({ token })`), a query vem de `query<{ next?: string }>()`, e
  os dois são codificados ali. O retorno é `Href`
  (`Marked<string, "Href">`).
- `UrlPattern` é a união das rotas que o Astro resolve, escrita em
  `src/generated/url-patterns.ts` pela integração `urlPatterns()`
  (`src/urls/integration.ts`). Um padrão que nenhuma página serve não compila.
  `pnpm run typecheck` roda `astro sync` antes do `tsc`.
- Migrados: `/admin` e todas as rotas fora de curso (login, home, profile,
  calendar, courses, invite, check-in, `/c/...`, 403/404/500).
- `test/url-registry.spec.ts`: para cada prefixo de `MIGRATED_PREFIXES`, toda
  página está registrada e nenhum código fora de `src/urls/`, `src/generated/`
  e `src/runner/` escreve o caminho como literal. O teste também pega um
  caminho grudado numa interpolação (`${origin}/c/...`).

## O que falta nesta etapa

Tudo sob `/[discipline]/[course]`, exceto os exames, que ficam para a etapa
seguinte, e o curso é a maior parte. Levantamento em 2026-11-19: 115
template strings do tipo `` `${href}/...` `` em 40 arquivos, mais 17 chamadas
de `courseHref`. Os pontos centrais são `courseHref` (`src/urls/index.ts`),
`src/utils/course-tabs.ts`, `src/utils/course-nav.ts`,
`src/utils/course-tabs-nav.ts`, `src/utils/breadcrumbs.ts` e os componentes
que recebem um `href` base e anexam pedaços (`CourseHeader.astro`, tabelas de
recursos, repositórios, chamada, questões). Os links de exame
(`` `${course.href}/exams/${slug}` ``) aparecem em páginas do curso: decidir
se entram aqui ou com os exames.

## Decisões a tomar

1. **Wrapper de `CourseRef`.** `route("/[discipline]/[course]")` recebe
   `{ discipline, course }`, onde `course` é o segmento `<username>_<edition>`.
   O registro precisa de uma camada que receba `CourseRef` e monte o
   segmento, para `courseHref` passar a delegar a ela. Uma forma aninhada,
   como `urls.course(ref).roster()`, combina com o jeito como os componentes
   recebem a base hoje.
2. **Props: objeto de URLs ou `Href`.** Os componentes passam a receber
   `course: CourseUrls`, que monta as sub-rotas, ou continuam recebendo
   `href: Href` e anexam pedaços? Anexar a um `Href` produz `string`, e isso
   contraria o ADR. A recomendação é o objeto.
3. **Teste de literais para rotas com parâmetro.** O teste atual compara
   prefixos estáticos, e o curso começa por `/[discipline]`. É preciso outra
   regra, por exemplo: nenhum template string fora de `src/urls/` que comece
   com `${...}/` seguido de um segmento estático de rota de curso (`exams`,
   `roster`, `resources`, ...). Os nomes desses segmentos podem ser
   derivados de `discoverRoutes()`.
4. **`.href` dos objetos de curso.** Vários loaders devolvem cursos com um
   campo `href` já montado (`course.href`, `meeting.course.href`). Decidir se
   esse campo passa a ser `Href` ou se dá lugar às URLs do registro.

## Como trabalhar

- Outras sessões editam a árvore principal ao mesmo tempo. A última etapa foi
  feita num worktree (`git worktree add ../codehood-typed-routes -b
  typed-routes main`), com commits lá e merge fast-forward no fim. Para o
  worktree rodar lint e testes: `ln -s ../codehood/node_modules node_modules`,
  `pnpm run db:generate`, `pnpm run generate`. Antes do
  `git worktree remove`, apague o symlink.
- O shell é zsh: uma variável com vários caminhos não é dividida em palavras.
  Use um array (`FILES=(a b); git restore -- "${FILES[@]}"`).
- Migre arquivo por arquivo com substituições que conferem a contagem
  esperada. Rode `pnpm exec biome check --write .` para ordenar os imports.
- Um `<script>` de componente `.astro` e as ilhas Solid podem importar
  `@/urls`, como já fazem `EnrollDialog.astro` e `ExamAttempt.tsx`.
- Antes do merge: `pnpm run lint` e `pnpm test` no branch, depois rebase
  sobre o `main` atual. No rebase da etapa anterior, o teste de literais pegou
  uma página nova do `main` (`assignments/[slug].astro`) com `"/404"` escrito
  à mão: rode o `url-registry.spec` de novo depois de cada rebase.

## Depois do curso

Exames, por último. Depois, o componente `<Link href: Href>` (`.astro` e
Solid), as saídas `external(url)` e `anchor(id)`, e o plugin GritQL que
proíbe `<a href>` fora do `Link`, ligado quando a migração terminar (ADR 0022).
