---
type: adr
status: accepted
tags: [ui, dev, design]
created: 2026-10-31
decided: 2026-10-31
---

# Tuner: calibrar a interface com o humano

Para calibrar valores visuais, o agente põe na página o painel
`src/components/dev/Tuner.astro`, que expõe variáveis CSS como controles. O
humano ajusta ao vivo e cola de volta o JSON gerado. O painel só renderiza no
dev server e sai antes do commit.

## Contexto

Ajustes visuais (tamanho, cor, força de um padrão) costumam levar várias
rodadas de "mude para X, tire screenshot, mostre". É mais rápido o humano
mexer nos valores na própria página e devolver o resultado ao agente.

## Decisão

`src/components/dev/Tuner.astro` mostra um painel flutuante com controles.
Cada parâmetro define uma variável CSS num seletor, e pode valer só para um
tema. A página muda ao vivo, sem recarregar. As escolhas ficam no
`localStorage` (`tuner:<id>`), então sobrevivem ao reload do dev server.
O botão "Copiar JSON" gera o que o humano cola na conversa. O painel se
arrasta pelo cabeçalho, e a posição também fica salva (`tuner:<id>:pos`).

O componente só renderiza no dev server (`import.meta.env.DEV`). Esquecido
numa página, não chega à produção, mas deve sair antes do commit.

## Como usar

1. Exponha o que vai ser calibrado como variáveis CSS no componente alvo.
   Valores compostos se quebram em partes: em vez de
   `--x: color-mix(in oklab, #b5452a 55%, #f7f3ea)`, declare `--x-color`,
   `--x-mix` e monte o `color-mix` no `fill`.
2. Ponha o `Tuner` temporariamente na página ou no layout:

   ```astro
   <Tuner
     id="glass-wall"
     title="Parede de vidro"
     params={[
       { name: "cell", var: "--gw-cell", selector: ".glass-wall", kind: "range", min: 12, max: 48, value: 24, unit: "px" },
       { name: "darkMix", var: "--gw-mix", selector: ".glass-wall", theme: "codehood-dark", kind: "range", min: 10, max: 100, value: 50, unit: "%" },
       { name: "darkBlend", var: "--gw-blend", selector: ".glass-wall", theme: "codehood-dark", kind: "select", options: ["screen", "lighten"], value: "screen" },
     ]}
   />
   ```

   Tipos: `range` (`min`, `max`, `step`, `unit`), `color`, `select`
   (`options`) e `text`. `value` é o valor atual no código, o que faz
   "Resetar" voltar a ele e `changed` listar só o que o humano mudou.
   Parâmetros `color` mostram a paleta do Codehood como amostras
   (`src/components/dev/palette.ts`): a do tema do parâmetro, ou as duas se
   ele não tiver tema. Quando o valor é uma cor da paleta, o JSON traz o nome
   dela em `swatch`.
3. Peça ao humano para ajustar e colar o JSON. Ele tem `changed` (só o que
   mudou) e `values` (todos, com `var` e `theme`), o suficiente para levar os
   valores ao CSS.
4. Aplique os valores no código e remova o `Tuner`. Os valores salvos no
   `localStorage` só valem enquanto o painel está na página. Se ele voltar
   com o mesmo `id`, clique em "Resetar" para que os padrões novos valham.

Para calibrar algo que não é CSS, omita `var` e ouça o evento
`tuner:change` em `window`; `detail` traz `{ id, values }`.
