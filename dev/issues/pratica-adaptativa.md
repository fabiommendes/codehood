---
type: issue
status: backlog
tags: [exams, practice, students]
relatedTo: [exam-state, response-service]
kind: enhancement
created: 2026-10-21
creator: Fábio Macêdo Mendes
---

# Prática adaptativa

## Contexto

Uma sessão de prática sorteia as questões da prova sempre do mesmo jeito,
sem olhar o histórico do aluno. Quem já domina metade do conteúdo refaz o
que já sabe.

O histórico de `Response` e `Submission` das sessões anteriores já basta;
não precisa de tabela nova.

## Requisitos

- R1. A sessão de prática dá preferência às questões e tags em que o aluno
  errou mais ou que não vê há mais tempo (repetição espaçada simples).
  - Aceitação: numa nova sessão, questões erradas ou vistas há mais tempo
    aparecem antes das que o aluno acertou recentemente.

## A decidir

- Se a prova de prática declara um banco maior que o número de questões por
  sessão, ou se a seleção adaptativa vale só para provas com `include-all`.
- Fórmula de prioridade (erro recente, tempo desde a última vista) e se o
  aluno pode desligar.
