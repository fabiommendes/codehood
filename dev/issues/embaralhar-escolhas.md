---
type: issue
status: todo
tags: [mdq, exams, shuffle]
kind: enhancement
created: 2026-10-28
creator: Fábio Macêdo Mendes
---

# O servidor não embaralha as escolhas

## Contexto

Só o pool das questões de ordenação é embaralhado: `shufflePool` devolve
qualquer outra questão sem mudança (`src/mdq/shuffle.ts:18`), e é a única
chamada na página da prova (`src/pages/[discipline]/[course]/exams/[slug].astro:359`).
As escolhas de multiple-choice, multiple-selection, true-false e dos blanks de
escolha de um fill-in aparecem na ordem do documento. O campo `shuffle` existe
no schema público (`src/mdq/public-schema.ts:72`, `:80`, `:88`, `:132`), mas
nada o lê. A prova também não guarda um `shuffle` próprio para o `inherit`
resolver: não há nada sobre isso em `prisma/schema.prisma` nem em `src/db/`.

O mdq permite embaralhar quando `shuffle` é `true` e proíbe quando é `false`,
então a ordem atual não viola a especificação.

## Requisitos

- R1. Embaralhar as escolhas de multiple-choice, multiple-selection e
  true-false, e as dos blanks de escolha de fill-in, quando o `shuffle`
  efetivo da questão for `true`.
  Aceitação: duas tentativas diferentes da mesma prova veem ordens diferentes
  para uma questão com `shuffle: true`; uma questão com `shuffle: false`
  mantém a ordem do documento.
- R2. Resolver `inherit` com o `shuffle` da prova, e tratar como `false` fora
  de uma prova.
  Aceitação: uma questão com `inherit` segue o valor da prova.
- R3. Usar a mesma semente do pool (tentativa e slug), para a ordem não mudar
  ao recarregar.
  Aceitação: recarregar a página da prova mantém a ordem.

## Fora do escopo

Preservar a ordem já vista em tentativas abertas. Ativar o embaralhamento muda
a ordem que os alunos com tentativa em andamento já viram.
