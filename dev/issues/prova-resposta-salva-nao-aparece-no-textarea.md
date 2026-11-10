---
type: issue
status: todo
tags: [exam, student, hydration, mdq]
kind: bug
priority: high
created: 2026-11-10
creator: claude
---

# Resposta de redação salva não aparece no campo ao reabrir a prova

Confirmado num navegador real (Chromium, e2e, 5 de 5 execuções), só para
questões `essay` de conteúdo `text` ou `plain`.

## Problema

Com uma resposta já salva no servidor, o `<textarea class="mdq-textarea">`
chega do SSR como `<textarea value="...">`. `textarea` não tem atributo
`value`, então o navegador o ignora, e a hidratação do Solid não aplica a
propriedade. O campo fica vazio para sempre, com o placeholder visível.

Valores medidos (`el.value`, atributo `value`, `textContent`), logo após o
carregamento e depois que `astro-island[ssr]` some:

| Campo                   | antes da hidratação                  | depois da hidratação                 |
| :---------------------- | :----------------------------------- | :----------------------------------- |
| essay (`<textarea>`)    | `""`, attr `saved essay`, texto `""` | `""`, attr `saved essay`, texto `""` |
| short-answer (`<input>`)| `Brasilia`, attr `Brasilia`          | `Brasilia`                           |
| numeric (`<input>`)     | `42`, attr `42`                      | `42`                                 |

`input` aceita o atributo `value`, por isso só a redação falha. O mesmo vale
em `0304414`, antes dos commits de prova recentes: não é regressão deles.

## O que o aluno vê e o servidor guarda

O campo aparece vazio, mas o servidor guarda o texto. Digitar de novo
sobrescreve a resposta sem o aluno ter visto a anterior. Rascunho local
restaurado por `restoreDrafts` aparece, porque entra por mudança de sinal
depois da hidratação.

## Causa

`mdq/src/solid/Essay.tsx`, `<textarea value={text()}>`: o Solid emite `value`
como atributo no SSR e não o reaplica como propriedade ao hidratar. O componente
vem do pacote `mdq` (`node_modules/mdq`), não de `src/components/`.

## Direção

Corrigir `Essay` no mdq: definir a propriedade (`prop:value={text()}`) ou
renderizar o texto como conteúdo do `textarea`. A correção exata não foi
testada. O teste de regressão é `test.fixme` em `test/exam-delivery.spec.ts`
("a saved essay answer shows in its field after a reload"); tire o `fixme`
quando corrigir.

## Relacionado

Digitar antes da hidratação não é salvo: outra causa (a ilha ainda não ligou
o `onInput`), não a mesma deste bug.
