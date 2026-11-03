---
type: issue
status: todo
tags: [cli, enrollment, grades, csv]
relatedTo: [grade-column-service, enrollment-service]
kind: enhancement
created: 2026-10-21
creator: Fábio Macêdo Mendes
---

# Importar e exportar turma e notas

## Contexto

No início do semestre o professor tem a lista de alunos do sistema acadêmico
(SIGAA, no caso da UnB) e no fim precisa lançar a pauta lá.

Parte da exportação já existe, só na web e num formato próprio: a aba de
notas baixa um CSV com uma linha por aluno e uma coluna por prova e por
coluna de nota (`src/pages/[discipline]/[course]/grades.astro:36`), e a
lista da turma também baixa CSV (`src/pages/[discipline]/[course]/roster.astro:120`).
Não há importação de turma.

## Requisitos

- R1. Um comando na CLI importa a turma de um CSV (matrícula, nome, e-mail) e
  gera convites pessoais para quem não tem conta.
  - Aceitação: depois da importação, cada linha do CSV corresponde a um aluno
    matriculado ou a um convite pessoal pendente.
- R2. Um comando na CLI exporta as notas em CSV no formato que o sistema
  acadêmico aceita, a partir das colunas de nota que já existem.
  - Aceitação: o arquivo gerado é aceito pelo sistema acadêmico sem edição.

## A decidir

- Formatos suportados: um CSV genérico com mapeamento de colunas basta?
- Se a importação fica na CLI ou também na web.
