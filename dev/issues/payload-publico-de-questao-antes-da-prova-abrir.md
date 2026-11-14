---
type: issue
status: todo
tags: [exam, question, attachment, security]
kind: bug
priority: medium
created: 2026-11-13
creator: claude
---

# `publicPayload` de questão de prova é legível antes da abertura

Achado por leitura de código durante a spec `dev/specs/to-do/anexos-de-questoes-e-provas.md`
(R18). Não reproduzido em teste.

## Problema

`visibility()` em `src/services/question-status.ts:35` decide o que um membro
do curso recebe de uma questão. Para uma questão `PUBLISHED`, devolve `public`
sem olhar a janela da prova que a usa. Quem está no curso lê o `publicPayload`
dessa questão antes de a prova abrir.

## Impacto

- O enunciado e as alternativas de uma prova agendada ficam acessíveis antes
  da hora.
- Os anexos cercados da questão (`text`) vão dentro do `publicPayload`, então
  também ficam expostos. A proteção de R12 cobre só os anexos por link.

## Por que não é corrigido agora

A spec trata isso como limitação conhecida da v1 e a deixa fora de escopo.

## Caminho provável

Tratar a questão de uma prova agendada que ainda não abriu como `absent` para
membros que não são autores, com a mesma regra usada para rascunhos. Os
anexos cercados precisam entrar na mesma regra, senão o vazamento continua.
