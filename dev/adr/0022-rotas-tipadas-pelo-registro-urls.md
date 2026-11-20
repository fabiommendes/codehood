---
type: adr
status: accepted
tags: [urls, rotas, paginas, tipos]
created: 2026-11-19
creator: claude
---

# Rotas tipadas pelo registro `urls`

Os links do servidor eram montados com template strings
(`` `${props.href}/grading/${q}?view=list` ``): eram 113 assim, em 39 arquivos.
Quando uma página era renomeada, os links para ela quebravam em silêncio, e
cada lugar que montava um link cuidava do próprio encoding. Este documento diz
como as URLs passam a ser montadas e como migrar o que falta.

## Decisão

- **Um registro escrito à mão, em `src/urls/routes.ts`.** `urls` tem uma função
  por rota, aninhada como as URLs (`urls.admin.users()`). As funções recebem
  tipos do domínio (`CourseRef`, slug), não as strings dos arquivos, e o
  encoding é feito ali.
- **`Href`, uma string marcada.** Toda função do registro devolve
  `Href = Marked<string, "Href">`. Um `Href` vale onde se espera `string`, mas
  uma string comum não vale onde se espera `Href`.
- **`UrlPattern`, gerado pelo Astro.** A integração `urlPatterns()`
  (`src/urls/integration.ts`) escreve em `src/generated/url-patterns.ts` a
  união dos padrões de todas as rotas do projeto. Ela roda no hook
  `astro:routes:resolved`, que dispara em `astro sync`, `astro build` e no
  `astro dev`. Cada rota é declarada por `route(pattern, query?)`, que tira
  os nomes dos parâmetros do próprio padrão (`route("/invite/[token]")` recebe
  `{ token }`) e monta a URL a partir dele, então montagem e padrão não
  divergem. Um padrão que nenhuma página serve não compila. `pnpm run typecheck` roda `astro sync` antes do `tsc`.
- **`<a>` passa por `<Link href: Href>`.** O link tem duas versões, uma
  `.astro` e outra Solid. Um plugin GritQL do Biome proíbe `<a href>` fora
  delas. A regra não lê tipos: o tipo da prop garante que o link foi montado
  pelo registro, e a regra garante que ninguém contorna o `Link`.
- **Saídas explícitas para o que não é rota nossa:** `external(url)` para
  links externos e `mailto:`, `anchor(id)` para `#id` na mesma página.
  Qualquer exceção à regra fica visível no código.
- **Query string e âncora preservam a marca.** As rotas que levam parâmetros
  de query os recebem tipados (`exam.grading.question(q, { list, names })`).
  Os construtores de `src/urls/` que juntam query ou âncora a um `Href`
  devolvem `Href`. Concatenar strings a um `Href` produz `string`, e o
  resultado não passa no `Link`.
- **Migração por prefixo.** `test/url-registry.spec.ts` tem
  `MIGRATED_PREFIXES`. Para cada prefixo da lista, toda página dele precisa
  estar no registro, e nenhum código fora de `src/urls/` escreve o caminho
  como literal. A regra do `<a>` só é ligada quando os links ainda não
  migrados deixarem de quebrá-la, seja por prefixo, seja no fim da migração.
  Ordem: `/admin` e as rotas fora de curso (feitos), depois o curso e por
  último os exames.

## Alternativas descartadas

- **`astro-typesafe-routes`.** A documentação declara suporte ao Astro 4 e 5,
  e o projeto está no 7. É dependência de um mantenedor só, e a API mudou
  bastante entre as versões 2 e 4. Os parâmetros seriam as strings dos
  arquivos: `[course]` vira `string`, e não o `CourseRef` composto.
- **Estreitar `href` nos tipos de JSX por declaration merging.** O TypeScript
  não deixa uma interface mesclada mudar o tipo de uma propriedade que já
  existe (TS2717). As declarações são `href?: string | URL | null` no Astro e
  `href?: string` no Solid.
- **`pnpm patch` nos tipos do Astro e do Solid.** Checaria todo `<a>` sem
  componente, mas o patch teria de ser refeito a cada atualização das duas
  bibliotecas.
- **Gerador próprio a partir de `src/pages/`.** Teria o mesmo problema dos
  parâmetros como strings. `UrlPattern` aproveita a geração só para conferir
  os padrões e deixa a montagem da URL com o registro.

## Como adicionar uma rota

1. Crie a página em `src/pages/`. O `astro dev` (ou `astro sync`) acrescenta o
   padrão a `UrlPattern`.
2. Registre a rota em `urls` com `route("/x/[id]")`, mais
   `query<{ ... }>()` se ela lê a query string. Para receber tipos do domínio
   (`CourseRef`), embrulhe a rota numa função que os converte.
3. Faça os links com `<Link href={urls.x()}>`.
