---
type: issue
status: backlog
tags: [runner, javascript, typescript, grading]
kind: enhancement
priority: low
created: 2026-11-10
creator: claude
---

# Runner de JavaScript e TypeScript ignora arquivos além do `entry`

## Problema

`RunRequest.files` aceita vários arquivos, e os drivers de Python, Lua,
Prolog e Elm gravam todos em `/work`, de onde o programa pode importá-los. O
driver de JavaScript roda só `files[entry]` como corpo de uma função
assíncrona (`runScript` em `src/runner/sandbox/drivers/javascript.ts`); os
outros arquivos são descartados, como diz o comentário do módulo ("other
files in `files` are ignored for now"). O de TypeScript compila o `entry` e
repassa ao de JavaScript, então herda a limitação.

Hoje nenhum consumidor manda mais de um arquivo, por isso não há defeito
visível.

## Por que importa

A correção local de exemplos em questões de código (ainda sem spec) quer
mandar o código do aluno junto com um arquivo de testes e rodar os testes
como `entry`. Em JS e TS isso não funciona: o arquivo de testes não consegue
importar o do aluno.

## Direção

- Carregar cada arquivo como módulo ES a partir de um `Blob` URL, resolvendo
  os `import` relativos entre eles por um mapa de nomes para URLs, e manter o
  `entry` com top-level `await`, `prompt()` e os stacks limpos que já tem.
- O laço que grava `files` em `/work` está repetido em
  `drivers/python.ts`, `drivers/prolog.ts` e `drivers/lua.ts`. Se a mudança
  tocar esses drivers, extrair um `writeWorkFiles(fs, files)` comum.

## Critério de aceite

Com `files = { "main.js": "import { f } from './lib.js'; console.log(f(2));",
"lib.js": "export const f = (n) => n * 2;" }` e `entry = "main.js"`, a saída
é `4`. O mesmo vale em TypeScript, com `.ts`.
