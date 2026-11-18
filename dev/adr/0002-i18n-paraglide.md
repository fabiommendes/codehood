---
type: adr
status: accepted
tags: [i18n, ui, build]
created: 2026-10-20
decided: 2026-11-06
deciders: [fabio, claude]
---

# Internacionalização com Paraglide JS, idioma fixo por instalação

## Context

Todo texto da interface, das mensagens de erro e dos e-mails está escrito em
inglês direto no código, e as datas usam `"en-US"` fixo. Cada instalação do
Codehood atende a um único idioma e faz o próprio build.

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

Um texto que depende de um enum seleciona a variante pelo valor, em vez de
interpolar um substantivo já traduzido. Cada idioma escreve a frase inteira (e
resolve a concordância), e o Paraglide tipa o parâmetro como a união dos valores:

```json
"exams_attempt_missed": [{
  "declarations": ["input type"],
  "selectors": ["type"],
  "match": {
    "type=PRACTICE": "You did not take this practice exam.",
    "type=QUIZ": "You did not take this quiz.",
    "type=EXAM": "You did not take this exam."
  }
}]
```

Uma frase com marcação no meio (link, `<code>`, `<strong>`) é uma mensagem só,
com placeholders, renderizada com `set:html`. O texto do catálogo é confiável;
cada valor passado a ela passa por `escapeHtml` de `@/i18n`.

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

### 5. Regras de build e lint

- **R1.** Sem `CODEHOOD_LOCALE`, o idioma é `en`. Um valor fora de
  `project.inlang/settings.json` faz o build falhar com a lista dos idiomas
  disponíveis.
- **R5.** `pnpm run lint` (`scripts/i18n-check.ts`) falha quando um idioma não
  tem uma chave do idioma base, tem uma chave que o base não tem, usa
  parâmetros diferentes numa mesma chave, quando um arquivo de `messages/` não
  está listado em `settings.json` (o plugin não aceita glob) e quando uma chave
  não começa com o nome da área do arquivo.
- Acrescentar um idioma é criar `messages/<locale>/`, listá-lo em
  `settings.json` e preencher os mapas indexados por `Locale` (o `tsc` aponta
  quais). A tradução pt-BR segue os termos do `GLOSSARY.md`.

### 6. Fora do escopo

Não passam por `m.*`:

- a CLI Python (`cli/`) e a saída dos comandos de `src/commands/`;
- `src/pages/design/*` (documentação do design system) e
  `src/pages/{api,rpc}/docs` (documentação para desenvolvedores);
- logs e mensagens de exceções internas que nunca chegam ao usuário;
- conteúdo criado por usuários (disciplinas, questões, materiais).

O `code` dos erros continua estável e em inglês, porque clientes dependem dele;
só a mensagem é traduzida.

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
