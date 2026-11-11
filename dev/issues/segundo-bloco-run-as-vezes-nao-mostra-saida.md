---
type: issue
status: backlog
tags: [runner, tests]
kind: bug
priority: medium
created: 2026-11-11
creator: claude
---

# Segundo bloco `run` às vezes não mostra a saída

Numa página com dois blocos `js run`, clicar em Run nos dois em sequência às
vezes deixa o terminal do segundo vazio para sempre. O primeiro mostra a saída
normalmente.

## Sintoma

`test/runner-markdown-blocks.spec.ts`, teste "run blocks run and share one
iframe, the others stay static", falha de forma intermitente:

```
Locator: locator('[data-code-runner]').nth(1).locator('[data-terminal] .xterm-accessibility-tree')
Expected substring: "second-out"
Received string:    "   "
Timeout: 20000ms
```

O terminal do segundo bloco existe e fica vazio pelos 20 s inteiros, então não é
lentidão: a execução não começa ou a saída se perde.

## Quando aparece

- Visto em 2 de 8 execuções do escopo `e2e` com 4 workers em 2026-11-11, com a
  máquina em carga 14 a 20. Não apareceu com 1 ou 2 workers.
- A página espera a hidratação antes dos cliques (`test/fixtures.ts`), então a
  causa não é clique antes da hidratação.
- Os dois cliques saem um logo após o outro, antes de o iframe compartilhado
  terminar de carregar. Suspeita, não verificada: a segunda execução é pedida
  enquanto a primeira ainda está reservando o iframe, e o pedido se perde.

## O que falta

Reproduzir de forma determinística (atrasar a carga do iframe ou do Worker) e
decidir se o defeito está no runner ou no teste.
