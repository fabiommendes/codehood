---
type: issue
status: todo
tags: [mdq, runner, exams, questions]
kind: enhancement
priority: low
created: 2026-11-13
creator: claude
---

# mdq: formalizar a fonte de teste inteiramente pública

Issue a abrir no repositório do mdq (`../mdq`). Fica registrada aqui até ser
levada para lá.

## Problema

O pré-teste no navegador (`dev/specs/to-do/fila-de-correcao-externa.md`, R23)
manda ao runner o texto inteiro de uma fonte de teste, quando todas as regiões
dela são públicas. O mdq diz outra coisa: as linhas antes da primeira anotação
(os imports) não pertencem a nenhuma região e são privadas
(`../mdq/docs/question-types/code.md`, seção sobre fontes anotadas, por volta
das linhas 370 a 413). A forma pública da questão (`publicTests`) leva só o
trecho de cada região pública.

Sem os imports e o cabeçalho do módulo, o trecho público não compila. O
servidor então escolhe, por conta própria, mandar a fonte inteira. É uma
decisão do host que o mdq não descreve, e outro host pode decidir diferente.

## Proposta

- O mdq define quando uma fonte de teste é "inteiramente pública": toda região
  dela é pública.
- Para essas fontes, a forma pública pode levar o texto completo, com as linhas
  fora de região, num campo próprio (por exemplo `publicSources`), separado de
  `publicTests`.
- Fontes com alguma região oculta continuam como hoje: só os trechos públicos.

## Enquanto não muda

O servidor decide em `src/utils/pretest-sources.ts` e entrega pelo
`QuestionService.pretests`. Uma fonte com região oculta nunca sai inteira.
