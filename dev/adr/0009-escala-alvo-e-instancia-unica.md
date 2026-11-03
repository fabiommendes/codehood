---
type: adr
status: accepted
tags: [deploy, sqlite, escala]
created: 2026-11-03
decided: 2026-08-27
creator: claude
---

# Escala alvo e instância única

O Codehood atende uma turma, não uma plataforma: cursos de até 250 alunos, uma
instância Node com um único arquivo SQLite, uma instituição por instalação.
Todo o resto do projeto pode assumir esses limites.

## Contexto

A meta foi fixada com os primeiros requisitos (commit `f81cff2`, 2026-08-27).
O banco é SQLite (`prisma/schema.prisma:22`), aberto por um único processo via
`better-sqlite3` (`src/db/client.ts:43`). O README descreve o deploy como um
`node dist/server/entry.mjs` atrás de um proxy HTTPS (`README.md:132`). Os
blobs ficam no disco local e são servidos pela própria app
(`src/pages/files/[hash].ts`, `src/db/services/blob.service.ts:392`), não pelo
proxy.

## Decisão

- Escala alvo: 250 alunos por curso, todos fazendo a mesma prova ao mesmo
  tempo. Orçamento: cerca de 20 requisições por aluno por hora, umas 5000 na
  hora da prova, em rajadas.
- Uma instância, um banco SQLite, um diretório de blobs. Sem réplicas, sem
  balanceador, sem fila externa.
- Uma instalação serve uma instituição. Multi-tenancy não é objetivo. É isso
  que permite o namespace global de disciplinas: `Discipline.slug` é a chave
  primária (`prisma/schema.prisma:323`). Idioma e fuso também são da
  instalação (ADR 0002, `SERVER_TZ` no README).
- O SQLite serializa escritas. Toda funcionalidade cuja taxa de escrita cresce
  com alunos x questões x tempo precisa ser conferida contra o orçamento antes
  de ser implementada.

## Consequências

- Nada de cache distribuído, lock entre processos ou sessão compartilhada: o
  processo é o único escritor.
- O autosave da prova não cabe no orçamento tal como foi pensado (salvar ao
  sair do campo, ao trocar de questão e após ~60 s ocioso). Hoje ele salva
  500 ms depois de cada pausa na digitação (`SAVE_DELAY_MS`,
  `src/components/exam/ExamAttempt.tsx:57`), imediatamente a cada mudança em
  questão não textual (`:190-194`) e ao sair do card (`:336`). Cada
  salvamento é uma transação que insere uma `Submission` nova
  (`src/db/services/response.service.ts:466`). Um aluno escrevendo uma
  resposta longa passa fácil de 20 requisições por hora. Isso não foi medido;
  rever o autosave contra o orçamento continua pendente.
- Crescer além disso (várias instituições, várias instâncias) exige trocar o
  banco e o armazenamento de blobs, e revisar esta decisão.
