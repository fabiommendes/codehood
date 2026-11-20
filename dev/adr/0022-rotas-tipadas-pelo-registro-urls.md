---
type: adr
status: accepted
tags: [urls, rotas, paginas, tipos]
created: 2026-11-19
creator: claude
---

# Rotas tipadas pelo registro `urls`

Links montados com template strings (`` `${href}/grading/${q}` ``) quebram em
silêncio quando uma página muda de nome, e cada um cuida do próprio encoding.

## Decisão

- **Um registro escrito à mão.** `urls` (`src/urls/routes.ts`) tem uma função
  por rota, aninhada como as URLs. As funções recebem tipos do domínio
  (`CourseRef`, slug), e o encoding é feito ali. As rotas do curso ficam em
  `urls.course(ref)`, que devolve um objeto com as sub-rotas.
- **`Href`, uma string marcada.** O registro devolve
  `Href = Marked<string, "Href">`. Um `Href` vale como `string`, mas uma
  `string` não vale como `Href`. Concatenar algo a um `Href` dá `string`.
  Query e âncora entram pelo registro (query tipada por rota, `withAnchor`),
  que preserva a marca.
- **Padrões conferidos pelo Astro.** Cada rota declara o padrão da página
  (`route("/invite/[token]")`), e os parâmetros saem dele. O Astro gera a
  união `UrlPattern` das rotas existentes, e um padrão que nenhuma página
  serve não compila.
- **Componentes recebem URLs, não bases.** Um componente que linka várias
  páginas do curso recebe `CourseUrls`, não um `href` para anexar pedaços.
  Ilhas Solid recebem o `CourseRef`, que é serializável.
- **`<a>` passa por `<Link>`**, em `.astro` e em Solid. A prop `href` é um
  `LinkTarget`: um `Href`, ou uma das exceções explícitas, `external(url)`
  para outro site e `mailto:`, e `anchor(id)` para `#id` na mesma página.
- **Um teste cobre o que os tipos não cobrem.** `test/url-registry.spec.ts`
  exige que toda página esteja no registro, rejeita caminhos de página
  escritos à mão fora de `src/urls/` e rejeita `<a` em `.astro` e `.tsx` fora
  dos dois `Link`. O tipo da prop garante a origem do link, e o teste garante
  que ninguém contorna o `Link`.

## Alternativas descartadas

- **`astro-typesafe-routes`.** Suporta Astro 4 e 5, não o 7. Tem um
  mantenedor só e mudou a API várias vezes. Os parâmetros seriam as strings
  dos arquivos (`[course]`), não o `CourseRef`.
- **Estreitar `href` nos tipos de JSX por declaration merging.** O TypeScript
  não deixa uma interface mesclada mudar o tipo de uma propriedade existente
  (TS2717).
- **`pnpm patch` nos tipos do Astro e do Solid.** Checaria todo `<a>`, mas o
  patch teria de ser refeito a cada atualização das bibliotecas.
- **Um plugin GritQL do Biome contra `<a>`.** O Biome 2.5 não roda plugins
  sobre o template `.astro`, onde está a maior parte dos links. Cobriria só
  as ilhas.
- **Gerar o registro a partir de `src/pages/`.** Os parâmetros também seriam
  strings. A geração serve só para conferir os padrões.
