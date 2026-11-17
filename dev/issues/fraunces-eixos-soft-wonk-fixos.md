---
type: issue
status: backlog
tags: [performance, ui]
kind: enhancement
priority: low
created: 2026-11-17
creator: claude
---

# A Fraunces vai com eixos variáveis que o CSS fixa

`src/styles/fonts.css` serve `fraunces-latin-full-normal.woff2` (121 KB), com os
quatro eixos: `opsz`, `wght`, `SOFT` e `WONK`. O `src/styles/global.css` fixa
`SOFT` em 100 e `WONK` em 1 nos títulos (`font-variation-settings`), então esses
dois eixos nunca variam.

## O que fazer

Gerar uma instância com `fontTools.varLib.instancer`, fixando `SOFT=100` e
`WONK=1` e mantendo `opsz` e `wght`. A estimativa é de 59 KB a menos por carga
a frio (o arquivo está em preload no `src/layouts/Layout.astro`).

## O que decidir

- Onde guardar o arquivo gerado (`public/fonts/` ou um script em `scripts/` que
  o gera a partir do pacote `@fontsource-variable/fraunces`) e como manter a
  licença (OFL) junto dele.
- Se algum lugar usa valores diferentes de `SOFT`/`WONK`. Hoje só os títulos
  definem os dois.
