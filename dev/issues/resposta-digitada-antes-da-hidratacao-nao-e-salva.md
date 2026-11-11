---
type: issue
status: backlog
tags: [exam, student, hydration]
kind: bug
priority: low
created: 2026-11-10
creator: claude
---

# Resposta digitada antes da hidratação não é salva

Na página da prova, o texto que o aluno digita antes de a ilha hidratar fica na
caixa, mas não é enviado ao servidor até a próxima tecla. O texto não se perde
na hidratação: só o salvamento automático deixa de vê-lo.

## Passos para reproduzir

1. Abrir uma prova em andamento com uma questão dissertativa, segurando os
   arquivos `/_astro/*.js` (em teste, `page.route` com uma promessa pendente).
2. Digitar na caixa de resposta.
3. Liberar os arquivos e esperar a hidratação (nenhum `astro-island[ssr]`).
4. Esperar sem tocar na página.

## Esperado

A resposta é salva depois da hidratação, como qualquer outra edição.

## Obtido

Em 2026-11-10, depois de 8 s parado, o servidor não tinha resposta alguma. Uma
tecla a mais salvou o texto inteiro, incluindo o trecho digitado antes.

## Quando acontece

A janela vai da chegada do HTML à hidratação. Em rede local são dezenas de
milissegundos, menos do que alguém leva para focar a caixa. Ela cresce em rede
lenta ou aparelho fraco, porque a página carrega perto de 1 MB de JavaScript
antes de hidratar. Não foi medida com rede limitada.

O caso com dano é o aluno que digita tudo nessa janela e não volta à questão.

## A verificar

O que a entrega da prova faz com esse texto: se lê o valor da caixa ou só o que
o salvamento automático registrou.

## Correção sugerida

Ao hidratar, comparar o valor de cada caixa com a resposta que veio do
servidor e agendar o envio quando forem diferentes. Vale também para as
respostas de código.

## Testes

Os testes que digitam logo após `page.goto` caíam nessa janela. Eles agora
abrem a página com `gotoHydrated` (`test/stories/helpers.ts`), o que esconde o
defeito. O teste de regressão precisa segurar os scripts, como nos passos acima.
