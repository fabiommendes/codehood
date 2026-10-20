---
type: adr
status: proposed
tags: [i18n, ui, build]
relatedTo: [specs/to-do/i18n]
created: 2026-10-20
deciders: [fabio, claude]
---

# Internacionalização com Paraglide JS, idioma fixo por instalação

## Context

Todo texto da interface, das mensagens de erro e dos e-mails está escrito em
inglês direto no código, e as datas usam `"en-US"` fixo. Cada instalação do
Codehood atende a um único idioma e faz o próprio build. O detalhamento e o
plano estão em [`dev/specs/to-do/i18n.md`](../specs/to-do/i18n.md).

## Options

- Dicionários próprios em TypeScript. Tipagem completa e nenhuma dependência,
  mas acabaríamos refazendo plural, seleção, verificação de traduções e
  integração com ferramentas.
- Paraglide JS. Compila mensagens JSON em funções ESM tipadas, sem runtime de
  parsing.
- i18next ou FormatJS. Fazem o parsing de ICU em runtime e têm tipagem fraca.

## Decision

Paraglide JS (`@inlang/paraglide-js`), com o plugin
`@inlang/plugin-message-format` carregado de `node_modules`, nunca de CDN.

### 1. Mensagens

`messages/<locale>/<area>.json`, um arquivo por área (`forms`, `grades`,
`errors`...). As chaves são planas, em snake_case e prefixadas pela área:
`grades_released_on`. Chaves aninhadas viram `m["grades.released"]`, por isso
não são usadas.

```json
{
  "grades_released_on": "Released {date}",
  "grades_submissions": [{
    "declarations": ["input count", "local countPlural = count: plural"],
    "selectors": ["countPlural"],
    "match": {
      "countPlural=one": "{count} submission",
      "countPlural=other": "{count} submissions"
    }
  }]
}
```

### 2. Uso

```ts
import { m } from "@/i18n";

throw new FieldError("slug", m.errors_slug_taken({ slug }));
```

```astro
<span>{m.grades_released_on({ date: formatDate(releasedAt) })}</span>
```

Toda string visível ao usuário passa por `m.*`, inclusive as mensagens de erro
da API REST. Um mesmo `code` de erro pode ter mensagens diferentes, então a
mensagem é escolhida onde o erro é lançado.

### 3. Idioma da instalação

`CODEHOOD_LOCALE` (padrão `en`) é lido no build e vira a constante
`experimentalStaticLocale` do Paraglide, via `define` do Vite. O bundler
descarta os outros idiomas. Um valor fora de `locales` faz o build falhar.

### 4. Formatação

Datas, números e tempo relativo usam os helpers de `src/i18n/`, que passam o
locale da instalação ao `Intl`. Ninguém escreve `"en-US"` fixo.

## Consequences

- Chaves e nomes de parâmetro são verificados pelo `tsc`. Os valores dos
  parâmetros não: o Paraglide os tipa como `NonNullable<unknown>`.
- O Paraglide usa o texto em inglês quando falta uma tradução, sem avisar.
  `scripts/i18n-check.ts`, rodado por `pnpm run lint`, exige as mesmas chaves e
  os mesmos parâmetros em todos os idiomas.
- `experimentalStaticLocale` é experimental. Se sumir, a saída é
  `strategy: ["custom-instance"]`, que devolve o mesmo valor em runtime.
- Os testes rodam em `en`, então as asserções sobre texto continuam valendo.
- O texto da interface sai do código e vai para arquivos JSON. Quem lê uma
  página `.astro` vê `m.chave()`, e não mais o texto.
